param(
  [string]$ProjectId = "smash-atoms-plus-projects",
  [string]$Region = "us-west1",
  [string]$WebService = "overwatch-web",
  [string]$ApiService = "overwatch-gateway"
)

$ErrorActionPreference = "Stop"

$gcloud = "C:\Users\alanj\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if (-not (Test-Path $gcloud)) {
  throw "gcloud not found at $gcloud"
}

Write-Host "Checking gcloud auth..."
$activeAccount = & $gcloud auth list --filter=status:ACTIVE --format="value(account)"
if (-not $activeAccount) {
  throw "No active gcloud account. Run: `"$gcloud`" auth login"
}

Write-Host "Using account: $activeAccount"
Write-Host "Setting project: $ProjectId"
& $gcloud config set project $ProjectId | Out-Null

Write-Host "Enabling required APIs..."
& $gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

Write-Host "Submitting Cloud Build deploy pipeline..."
& $gcloud builds submit `
  --project $ProjectId `
  --region $Region `
  --config "infra/gcp/cloudbuild.deploy.yaml" `
  --substitutions "_REGION=$Region,_WEB_SERVICE=$WebService,_API_SERVICE=$ApiService"

Write-Host "Fetching deployed URLs..."
$apiUrl = & $gcloud run services describe $ApiService --region $Region --format="value(status.url)"
$webUrl = & $gcloud run services describe $WebService --region $Region --format="value(status.url)"

Write-Host ""
Write-Host "Gateway URL: $apiUrl"
Write-Host "Web URL:     $webUrl"
