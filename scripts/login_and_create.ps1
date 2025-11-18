$resp = Invoke-RestMethod -Method Post -Uri 'http://localhost:4000/auth/login' -ContentType 'application/json' -Body (ConvertTo-Json @{ username='admin@agentfinance.com'; password='password' })
$token = $resp.token
Write-Output "TOKEN: $token"
$created = Invoke-RestMethod -Method Post -Uri 'http://localhost:4000/tasks' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body (ConvertTo-Json @{ action='Demo create from automation'; agentId='alpha' })
$created | ConvertTo-Json
# try again without agentId to avoid FK issues
$created2 = Invoke-RestMethod -Method Post -Uri 'http://localhost:4000/tasks' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body (ConvertTo-Json @{ action='Demo create (no agent)' })
$created2 | ConvertTo-Json
Write-Output "Listing tasks (latest):"
$list = Invoke-RestMethod -Method Get -Uri 'http://localhost:4000/tasks' -Headers @{ Authorization = "Bearer $token" }
$list | ConvertTo-Json -Depth 5
