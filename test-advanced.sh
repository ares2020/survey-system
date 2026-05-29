TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsImlhdCI6MTc4MDA1NDg3MywiZXhwIjoxNzgwMTQxMjczfQ.fBXakMXSZRCDueYOP5SyrKNJ_EoIcFeSGI8Ekl520xg"

echo "=== Change Password ==="
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3001/api/admin/password \
  -d '{"oldPassword":"admin123","newPassword":"newpass456"}' | python3 -m json.tool

echo ""
echo "=== Login with New Password ==="
curl -s -X POST -H "Content-Type: application/json" \
  http://localhost:3001/api/admin/login \
  -d '{"username":"admin","password":"newpass456"}' | python3 -m json.tool

echo ""
echo "=== Export Excel ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/admin/export/excel?format=xlsx" \
  -o /tmp/test-export.xlsx && echo "Excel exported: $(ls -la /tmp/test-export.xlsx)"

echo ""
echo "=== Export Raw ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/admin/export/raw?format=json" | python3 -m json.tool | head -30

echo ""
echo "=== Restore Password ==="
NEW_TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  http://localhost:3001/api/admin/login \
  -d '{"username":"admin","password":"newpass456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -s -X POST -H "Authorization: Bearer $NEW_TOKEN" -H "Content-Type: application/json" \
  http://localhost:3001/api/admin/password \
  -d '{"oldPassword":"newpass456","newPassword":"admin123"}' | python3 -m json.tool
