@echo off
setlocal

cd /d C:\Users\alanj\OneDrive\Desktop\overwatch

if exist tunnel-4010.log del /q tunnel-4010.log

start "" /b cmd /c C:\Windows\System32\OpenSSH\ssh.exe -o StrictHostKeyChecking=no -R 80:localhost:4010 nokey@localhost.run ^> tunnel-4010.log 2^>^&1
