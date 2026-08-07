#!/bin/bash

# Verification script for Zoom Phone RTMS app setup

echo "======================================"
echo "Zoom Phone RTMS Setup Verification"
echo "======================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check counters
PASSED=0
FAILED=0
WARNINGS=0

# Function to check if a file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} Found: $1"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} Missing: $1"
        ((FAILED++))
    fi
}

# Function to check if a directory exists
check_dir() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} Found: $1"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} Missing: $1"
        ((FAILED++))
    fi
}

# Function to check if a command exists
check_command() {
    if command -v "$1" &> /dev/null; then
        VERSION=$($1 --version 2>&1 | head -n 1)
        echo -e "${GREEN}✓${NC} $1 is installed: $VERSION"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1 is not installed"
        ((FAILED++))
    fi
}

# Function to check if env file has required variables
check_env_vars() {
    if [ -f "$1" ]; then
        if grep -q "your_client_id_here" "$1" || grep -q "your_client_secret_here" "$1" || \
           grep -q "your_zoom_client_id" "$1" || grep -q "your_zoom_client_secret" "$1"; then
            echo -e "${YELLOW}⚠${NC} $1 needs configuration (using example values)"
            ((WARNINGS++))
        else
            echo -e "${GREEN}✓${NC} $1 appears configured"
            ((PASSED++))
        fi
    else
        echo -e "${RED}✗${NC} $1 not found"
        ((FAILED++))
    fi
}

echo "1. Checking Prerequisites..."
echo "----------------------------"
check_command node
check_command npm
check_command docker
check_command ngrok
echo ""

echo "2. Checking Project Structure..."
echo "--------------------------------"
check_dir "frontend"
check_dir "backend"
check_dir "rtms"
check_dir "docs"
echo ""

echo "3. Checking Core Files..."
echo "------------------------"
check_file "frontend/src/App.js"
check_file "frontend/package.json"
check_file "backend/server.js"
check_file "backend/package.json"
check_file "rtms/server.js"
check_file "rtms/package.json"
check_file "docker-compose.yml"
check_file "README.md"
echo ""

echo "4. Checking Environment Configuration..."
echo "----------------------------------------"
check_env_vars ".env"
check_env_vars "frontend/.env"
check_env_vars "backend/.env"
check_env_vars "rtms/.env"
echo ""

echo "5. Checking Node Modules..."
echo "---------------------------"
if [ -d "frontend/node_modules" ]; then
    echo -e "${GREEN}✓${NC} Frontend dependencies installed"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Frontend dependencies not installed (run: cd frontend && npm install)"
    ((WARNINGS++))
fi

if [ -d "backend/node_modules" ]; then
    echo -e "${GREEN}✓${NC} Backend dependencies installed"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} Backend dependencies not installed (run: cd backend && npm install)"
    ((WARNINGS++))
fi

if [ -d "rtms/node_modules" ]; then
    echo -e "${GREEN}✓${NC} RTMS dependencies installed"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠${NC} RTMS dependencies not installed (run: cd rtms && npm install)"
    ((WARNINGS++))
fi
echo ""

echo "6. Checking Data Directories..."
echo "-------------------------------"
check_dir "rtms/data"
if [ ! -d "rtms/data/audio" ]; then
    mkdir -p rtms/data/audio
    echo -e "${GREEN}✓${NC} Created rtms/data/audio"
fi
if [ ! -d "rtms/data/transcripts" ]; then
    mkdir -p rtms/data/transcripts
    echo -e "${GREEN}✓${NC} Created rtms/data/transcripts"
fi
echo ""

echo "======================================"
echo "Verification Summary"
echo "======================================"
echo -e "Passed:   ${GREEN}$PASSED${NC}"
echo -e "Failed:   ${RED}$FAILED${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ $FAILED -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ Setup verification PASSED! You're ready to go.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Configure your .env files with Zoom credentials"
    echo "2. Start ngrok: ngrok http 3001"
    echo "3. Update Zoom Marketplace with ngrok URL"
    echo "4. Run: npm run dev:local (or docker compose up)"
    exit 0
elif [ $FAILED -eq 0 ]; then
    echo -e "${YELLOW}⚠ Setup verification completed with warnings.${NC}"
    echo ""
    echo "Please address the warnings above before proceeding."
    exit 1
else
    echo -e "${RED}✗ Setup verification FAILED!${NC}"
    echo ""
    echo "Please fix the errors above before proceeding."
    echo "Refer to README.md for help."
    exit 1
fi
