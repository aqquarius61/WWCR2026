import urllib.request
import json
import ssl

# SSL 검증 우회용 컨텍스트 (로컬 테스트 안정성 확보)
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

url = "https://mawaaenlnghpjgmkiyyo.supabase.co/rest/v1/cats?select=*&limit=1"
headers = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hd2FhZW5sbmdocGpnbWtpeXlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTI0MzgsImV4cCI6MjA5ODgyODQzOH0.Xu-Ah9KYKKPjPtr6NhkYnfZehrU-VVCiU9b-R0mwcbU",
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hd2FhZW5sbmdocGpnbWtpeXlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTI0MzgsImV4cCI6MjA5ODgyODQzOH0.Xu-Ah9KYKKPjPtr6NhkYnfZehrU-VVCiU9b-R0mwcbU"
}

print("=== 1. cats 테이블 스키마 샘플 조회 ===")
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        res_data = response.read().decode('utf-8')
        parsed = json.loads(res_data)
        print(json.dumps(parsed, indent=2, ensure_ascii=False))
except Exception as e:
    print("cats 조회 에러:", e)

print("\n=== 2. 스토리지 버킷 목록 및 설정 조회 ===")
url_storage = "https://mawaaenlnghpjgmkiyyo.supabase.co/storage/v1/bucket"
req_storage = urllib.request.Request(url_storage, headers=headers)
try:
    with urllib.request.urlopen(req_storage, context=ctx) as response:
        res_data = response.read().decode('utf-8')
        parsed = json.loads(res_data)
        print(json.dumps(parsed, indent=2, ensure_ascii=False))
except Exception as e:
    print("스토리지 조회 에러:", e)
