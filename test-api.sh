TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsImlhdCI6MTc4MDA1NDMyOCwiZXhwIjoxNzgwMTQwNzI4fQ.fxYQQIXXwWib-D3bD8bQzqKpMM4SqpIP6THizu9EBsU"

echo "=== Stats ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/stats | python3 -m json.tool

echo ""
echo "=== Submissions ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/submissions | python3 -m json.tool

echo ""
echo "=== Single Submission ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/submissions/1 | python3 -m json.tool

echo ""
echo "=== Delete (Soft) ==="
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/submissions/1 | python3 -m json.tool

echo ""
echo "=== Deleted List ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/submissions/deleted | python3 -m json.tool

echo ""
echo "=== Restore ==="
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/submissions/1/restore | python3 -m json.tool

echo ""
echo "=== Stats After Restore ==="
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/admin/stats | python3 -c "import sys,json; d=json.load(sys.stdin); print('Total:', d['data']['totalSubmissions'], 'Coverage:', d['data']['coverageRate'])"
