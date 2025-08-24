#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/../"

rm -rf dummy-git-working-copy
mkdir -p dummy-git-working-copy
cd dummy-git-working-copy
touch README.md
echo "Line 1" > README.md
git init
git add README.md
git commit -m "First import"
git remote add origin http://localhost:3334/git/repos1.git
