package main

import (
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const (
	host       = "10.203.64.67:22"
	remoteUser = "rtms"
	xorPad     = 0x5A
)

var callIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func usage() {
	fmt.Fprint(os.Stderr, `用法: download_call <call_id>

从 10.203.64.67 下载指定通话的 audio 和 transcripts。
本程序是独立可执行文件，不依赖本机 ssh/scp。

示例:
  ./download_call 7675615133888032930

下载结果（当前目录）:
  ./<call_id>/audio/
  ./<call_id>/transcripts/

远端目录:
  /home/rtms/audio/<call_id>
  /home/rtms/transcripts/<call_id>
`)
}

func main() {
	configureConsole()
	if len(os.Args) != 2 || os.Args[1] == "" || os.Args[1] == "-h" || os.Args[1] == "--help" {
		usage()
		os.Exit(1)
	}
	callID := os.Args[1]
	if !callIDPattern.MatchString(callID) {
		fmt.Fprintln(os.Stderr, "错误: call_id 格式无效。只允许字母、数字、下划线和短横线。")
		usage()
		os.Exit(1)
	}

	client, err := dialSFTP()
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: 连接失败: %v\n", err)
		os.Exit(1)
	}
	defer client.Close()

	outDir, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: 无法读取当前目录: %v\n", err)
		os.Exit(1)
	}
	callDir := filepath.Join(outDir, callID)
	audioRemote := path.Join("/audio", callID)
	transcriptsRemote := path.Join("/transcripts", callID)

	audioOK, err := downloadIfExists(client, audioRemote, filepath.Join(callDir, "audio"), "audio")
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: 下载 audio 失败: %v\n", err)
		os.Exit(1)
	}
	transcriptsOK, err := downloadIfExists(client, transcriptsRemote, filepath.Join(callDir, "transcripts"), "transcripts")
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: 下载 transcripts 失败: %v\n", err)
		os.Exit(1)
	}
	if !audioOK && !transcriptsOK {
		fmt.Fprintf(os.Stderr, "错误: 远端没有 call_id=%s 的 audio 或 transcripts。\n", callID)
		_ = os.Remove(callDir)
		os.Exit(1)
	}

	fmt.Printf("下载完成: %s\n", callDir)
	if audioOK {
		fmt.Printf("  audio:       %s\n", filepath.Join(callDir, "audio"))
	}
	if transcriptsOK {
		fmt.Printf("  transcripts: %s\n", filepath.Join(callDir, "transcripts"))
	}
}

func privateKeyPEM() []byte {
	out := make([]byte, len(keyXOR))
	for i, b := range keyXOR {
		out[i] = b ^ xorPad
	}
	return out
}

func dialSFTP() (*sftp.Client, error) {
	signer, err := ssh.ParsePrivateKey(privateKeyPEM())
	if err != nil {
		return nil, fmt.Errorf("parse embedded key: %w", err)
	}
	cfg := &ssh.ClientConfig{
		User:            remoteUser,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         20 * time.Second,
	}
	conn, err := ssh.Dial("tcp", host, cfg)
	if err != nil {
		return nil, err
	}
	client, err := sftp.NewClient(conn)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return client, nil
}

func downloadIfExists(client *sftp.Client, remoteDir, localDir, label string) (bool, error) {
	_, err := client.Stat(remoteDir)
	if err != nil {
		if os.IsNotExist(err) || isSFTPNotExist(err) {
			fmt.Fprintf(os.Stderr, "未找到 %s 目录: %s\n", label, remoteDir)
			return false, nil
		}
		return false, err
	}
	fmt.Printf("正在下载 %s: %s\n", label, remoteDir)
	if err := downloadTree(client, remoteDir, localDir); err != nil {
		return false, err
	}
	return true, nil
}

func isSFTPNotExist(err error) bool {
	return err != nil && (os.IsNotExist(err) || err.Error() == "file does not exist")
}

func downloadTree(client *sftp.Client, remoteDir, localDir string) error {
	entries, err := client.ReadDir(remoteDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		return err
	}
	for _, entry := range entries {
		remotePath := path.Join(remoteDir, entry.Name())
		localPath := filepath.Join(localDir, entry.Name())
		if entry.IsDir() {
			if err := downloadTree(client, remotePath, localPath); err != nil {
				return err
			}
			continue
		}
		if err := downloadFile(client, remotePath, localPath); err != nil {
			return err
		}
	}
	return nil
}

func downloadFile(client *sftp.Client, remotePath, localPath string) error {
	src, err := client.Open(remotePath)
	if err != nil {
		return err
	}
	defer src.Close()

	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return err
	}
	dst, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}
