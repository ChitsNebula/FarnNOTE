#!/bin/bash
# FarmNotes - Start Server & Auto Update for Linux & Chromebook
cd "$(dirname "$0")" || exit

echo "========================================================"
echo "  FarmNotes - Auto Updating..."
echo "========================================================"
git pull origin main

echo ""
echo "========================================================"
echo "  Starting FarmNotes Web Server at http://localhost:8080"
echo "========================================================"
python3 server.py || python server.py
