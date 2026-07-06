#!/bin/bash
cd "$(dirname "$0")"
git add .
git commit -m "update dashboard"
git push
echo ""
echo "✅ Done! Your dashboard will update in ~30 seconds."
read -p "Press Enter to close..."
