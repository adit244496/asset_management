# Deploying the IT Asset Engine

For a Windows Server. Users reach the app at `https://<server>:8018`.

```
Browser --HTTPS :8018--> nginx --> frontend/dist (static files)
                           |
                           +-- /api --> waitress 127.0.0.1:8019 --> PostgreSQL
```

Port 8019 is internal and never opened in the firewall. If it is taken, pass
`-ApiPort` to both `install.ps1` and `update.ps1`.

## What the server needs

- Python 3.10 or newer, and Node.js 22, both on `PATH`
- Git
- PostgreSQL, including `pg_dump` (used for backups)
- [nginx for Windows](https://nginx.org/en/download.html) 1.25.1 or newer, unzipped to `C:\nginx` (no need to configure it)
- [NSSM](https://nssm.cc/), with `nssm.exe` on `PATH`
- A TLS certificate and key for the server's name
- Port 8018 open on any network firewall between users and the server (the script handles Windows Firewall)

Use a certificate from your company's CA if you can. The QR camera scanner only works
over HTTPS, and with a self-signed certificate every user gets a browser warning.

Do not install under a path containing spaces. The script stops if you do.

## First install

Run everything in an **Administrator** PowerShell.

**1. Get the code**

```powershell
git clone <your-private-repo-url> E:\asset-management-it
cd E:\asset-management-it
```

**2. Create the database and its user.** Choose a strong password first.

```powershell
psql -U postgres -c "CREATE ROLE asset_app LOGIN PASSWORD 'your-db-password';"
psql -U postgres -c "CREATE DATABASE asset_management OWNER asset_app;"
```

**3. Run the installer.** The first run creates `backend\.env` and stops.

```powershell
.\deploy\install.ps1 -ServerName itassets.company.local `
    -CertFile C:\certs\itassets.crt -KeyFile C:\certs\itassets.key `
    -BackupDir D:\backups\asset-management
```

If scripts are blocked, first run `Set-ExecutionPolicy -Scope Process Bypass`.
Put `-BackupDir` on a different disk from the database.

**4. Edit `backend\.env`**, replacing both `CHANGE_ME` values:

- `DATABASE_URL`: the database password from step 2. Percent-encode `@ : / ? # %` (for example `@` becomes `%40`).
- `ADMIN_PASSWORD`: the starting password for the seeded accounts.

Add `GEMINI_API_KEY` if you want the AI assistant. Do not copy the `.env` from a
development machine.

**5. Run the same installer command again.** It finishes with `Installed: https://...`.

**6. Finish in the browser**

- Sign in as `superadmin` and set a new password.
- Sign in as `admin`, `verifier` and `viewer` and set theirs, because they share the starting password.
- Under **Master Data > Notifications**, set the app address to `https://<server>:8018`, or links in approval emails will not work, and enter the mail server details.

## Releasing an update

```powershell
cd E:\asset-management-it
.\deploy\update.ps1 -BackupDir D:\backups\asset-management
```

If you changed `nginx.conf.template` or moved a certificate, run `install.ps1` again.
It keeps the existing `.env` and data.

## What gets installed

| Item | Name | Purpose |
|---|---|---|
| Service | `AssetManagementAPI` | The backend, including scheduled emails |
| Service | `AssetManagementWeb` | nginx, separate from any other nginx on the server |
| Scheduled task | `AssetManagementBackup` | Database backup at 02:00, kept for 30 days |
| Firewall rule | `IT Asset Engine HTTPS 8018` | Inbound access to the app |

Logs are in `deploy\runtime\logs\`. `api.log` is the first place to look.

## Restoring a backup

Restore into an empty database and check it before switching over:

```powershell
createdb -U postgres asset_management_restore
pg_restore -U postgres -d asset_management_restore --no-owner <file>.dump
```

Keep `backend\.env` backed up securely as well. Without its `SECRET_KEY`, the saved
mail password cannot be read and must be entered again.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Not healthy after 120 seconds` | `deploy\runtime\logs\api.log`: usually a wrong `DATABASE_URL` or an unencoded password |
| Service will not start, nothing in `api.log` | Run `backend\.venv\Scripts\python.exe deploy\serve.py` directly to see the error |
| Site unreachable from other PCs | The network firewall allows 8018, and `AssetManagementWeb` is running |
| 502 from `/api` | `AssetManagementAPI` is stopped: see `api.log` |
| Port already in use | `netstat -ano | findstr "8018 8019"` |
