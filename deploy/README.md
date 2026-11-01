# Deploying the IT Asset Engine

For Ubuntu 24.04. Users reach the app at `https://itasset.ambujaneotia.com`.

```
Browser --HTTPS :443--> nginx --> /var/www/asset-management (static files)
                          |
                          +-- /api --> waitress 127.0.0.1:8018 --> PostgreSQL
```

The app is added to the server's existing nginx as one extra site, chosen by its name.
Other sites stay as they are: the installer tests the config before reloading, removes
its site if the test fails, and never restarts nginx.

Port 8018 is internal and is never opened in any firewall. To use a different port,
pass `--api-port` to `install.sh` (`update.sh` remembers it).

## What the server needs

- Python 3.10+, Node.js 20.19+, Git, nginx and PostgreSQL with `pg_dump`
- `sudo` access
- A DNS record for the app's name pointing at this server
- A TLS certificate for that name. The QR camera scanner only works over HTTPS.

```bash
sudo certbot certonly --nginx -d itasset.ambujaneotia.com
```

## First install

**1. Get the code**

```bash
cd ~
git clone https://github.com/adit244496/asset_management.git asset_management
cd asset_management
```

**2. Create the database and its user.** This prompts for a new password. Choose a
strong one and keep it for step 4.

```bash
sudo -u postgres createuser --pwprompt asset_app
sudo -u postgres createdb --owner=asset_app asset_management
```

**3. Run the installer.** The first run creates `backend/.env` and stops.

```bash
sudo env "PATH=$PATH" bash deploy/install.sh \
    --server-name itasset.ambujaneotia.com \
    --cert /etc/letsencrypt/live/itasset.ambujaneotia.com/fullchain.pem \
    --key /etc/letsencrypt/live/itasset.ambujaneotia.com/privkey.pem
```

`env "PATH=$PATH"` is needed so `sudo` can find Node.js if it was installed with `nvm`.

**4. Edit `backend/.env`** (`nano backend/.env`), replacing both `CHANGE_ME` values:

- `DATABASE_URL`: the password from step 2. Percent-encode `@ : / ? # %` (for example `@` becomes `%40`).
- `ADMIN_PASSWORD`: the starting password for the seeded accounts.

Add `GEMINI_API_KEY` if you want the AI assistant. Do not copy the `.env` from a
development machine.

**5. Run the same installer command again.** It finishes with `Installed: https://...`.

**6. Finish in the browser**

- Sign in as `superadmin` and set a new password.
- Sign in as `admin`, `verifier` and `viewer` and set theirs, because they share the starting password.
- Under **Master Data > Notifications**, set the app address to `https://itasset.ambujaneotia.com`, or links in approval emails will not work, and enter the mail server details.

## Releasing an update

```bash
cd ~/asset_management
sudo env "PATH=$PATH" bash deploy/update.sh
```

If you changed `nginx.conf.template` or the certificate path, run `install.sh` again.
It keeps the existing `.env` and data.

## What gets installed

| Item | Name | Purpose |
|---|---|---|
| Service | `asset-management-api` | The backend, including scheduled emails |
| Timer | `asset-management-backup.timer` | Database backup at 02:00, kept for 30 days |
| nginx site | `/etc/nginx/sites-available/asset-management` | HTTPS on 443 and the `/api` proxy |
| Web files | `/var/www/asset-management` | The built frontend |
| Backups | `/var/backups/asset-management` | Copy these off the server as well |
| Settings | `/etc/default/asset-management` | Server name and API port, read by `update.sh` |

## Everyday commands

```bash
systemctl status asset-management-api
journalctl -u asset-management-api -f       # backend log
sudo systemctl restart asset-management-api
systemctl list-timers asset-management-backup.timer
sudo systemctl start asset-management-backup.service   # back up now
```

## Restoring a backup

Restore into an empty database and check it before switching over:

```bash
sudo -u postgres createdb asset_management_restore
sudo -u postgres pg_restore -d asset_management_restore --no-owner <file>.dump
```

The `postgres` user must be able to read the file, so copy it to `/tmp` first.

Keep `backend/.env` backed up securely as well. Without its `SECRET_KEY`, the saved
mail password cannot be read and must be entered again.

## Troubleshooting

| Symptom | Check |
|---|---|
| `The API did not become healthy` | `journalctl -u asset-management-api`: usually a wrong `DATABASE_URL` or an unencoded password |
| `npm not found` | Include `env "PATH=$PATH"` in the `sudo` command |
| `nginx rejected the new site` | The error above it, usually a certificate path or a key that does not match |
| Another app or a certificate warning | The nginx site is missing: `ls /etc/nginx/sites-enabled/` |
| 502 from `/api` | `systemctl status asset-management-api` |
| Port already in use | `sudo ss -tlnp | grep ':8018\b'` |
