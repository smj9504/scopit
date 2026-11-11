# Deploying Scopit Community (Google Cloud)

The community runs on one small Google Cloud VM at `https://community.scopit.work`. Everything after a one-time setup is automatic and lives in this repository:

1. **Build** (`.github/workflows/community.yml`, every change under `community/`): GitHub Actions downloads Apache Answer 2.0.3 (checksum verified), builds it with the `pii-reviewer` plugin, runs the plugin tests, and packs the Pretendard fonts.
2. **Release** (main branch only): the workflow uploads the build to a Cloud Storage bucket. It signs in to Google Cloud with workload identity federation, so no key is stored in GitHub.
3. **Install**: the VM checks the bucket every three minutes (`vm-startup.sh`). For a new release it runs `vm-agent.sh`, which sets up the machine the first time (swap, Caddy, automatic security updates), installs Answer on first run, then swaps in the new binary, runs Answer's database upgrade, and restarts. If the new version does not start, it goes back to the previous one.
4. **Settings**: the workflow waits until the site reports the new release, then runs `scripts/apply-settings.mjs` with the admin login from Secret Manager (settings, branding, theme, plugin on, email).

Caddy serves the site over HTTPS with a Let's Encrypt certificate. The disk is snapshotted daily and snapshots are kept for 7 days.

## One-time setup (owner)

한국어 요약: 아래 1~4를 한 번만 하시면 됩니다. 10분 정도 걸립니다.

1. **Project.** In the [Google Cloud console](https://console.cloud.google.com/), create a project and link a billing account (the free tier also needs one). A budget alert (Billing > Budgets & alerts, for example $10 a month) is a good idea.
   - 콘솔에서 새 프로젝트를 만들고 결제 계정을 연결합니다. 예산 알림을 $10 정도로 걸어 두시길 권합니다.
2. **Setup script.** Open [Cloud Shell](https://shell.cloud.google.com/) and run:

   ```bash
   gcloud config set project YOUR_PROJECT_ID
   curl -fsSLO https://raw.githubusercontent.com/smj9504/scopit/main/community/deploy/gcp-setup.sh
   bash gcp-setup.sh
   ```

   It asks for the admin account's email and prints a generated admin password once (also kept in Secret Manager as `community-admin-password`). Save it.
   - Cloud Shell에서 위 세 줄을 실행합니다. 관리자 이메일을 물어보고, 만들어진 관리자 비밀번호를 한 번 보여 줍니다. 저장해 두세요.
3. **DNS.** scopit.work's DNS is at Namecheap (see `claims/docs/DEPLOY.md`). Domain List > `scopit.work` > Manage > Advanced DNS > Add New Record: **A Record**, Host `community`, Value the IP the script prints. The VM gets its own HTTPS certificate once this resolves.
   - Namecheap의 scopit.work DNS에 A 레코드를 추가합니다(Host `community`, 값은 스크립트가 알려 주는 IP).
4. **Config.** Put the last line the script prints (`GCP_PROJECT_ID=... GCP_PROJECT_NUMBER=...`) into `gcp.env` and merge to main. The workflow then deploys.
   - 스크립트 마지막 줄을 Claude에게 보내 주시면 `gcp.env`에 넣고 배포합니다.

**Email (needed before opening sign-ups).** New members must verify their email. Create a Resend API key (Resend > API Keys, "Sending access" for scopit.work) and store it in Cloud Shell:

```bash
printf '%s' 're_your_key' | gcloud secrets create community-smtp-password --data-file=-
```

Then run the workflow again (Actions > Community > Run workflow). Mail is sent as `Scopit Community <community@scopit.work>` (`settings.json` > `smtp`).

## Costs (us-east1)

| Item | Cost |
| --- | --- |
| e2-micro VM, 30 GB standard disk, bucket under 5 GB | Free tier |
| Public IPv4 address | About $3.65 a month (Google charges for in-use IPv4 addresses, the free VM included) |
| Daily snapshots, 7 kept | A few cents a month |
| Outbound traffic over 1 GB a month | About $0.12 per GB |

Check the current terms on Google's free tier page before relying on these numbers.

## Day to day

- **Deploy:** merge a change under `community/` to main, or run the workflow by hand (Actions > Community > Run workflow). The workflow waits up to 15 minutes for the VM and prints the VM's console if the release does not come up.
- **Settings:** `settings.json` and `theme/` are the source of truth. The workflow re-applies them on every deploy, so a change made by hand in Admin to the same settings is replaced. Members, posts, and plugin settings are not touched.
- **Admin password:** if you change it in Answer, update the secret too (`printf '%s' 'new' | gcloud secrets versions add community-admin-password --data-file=-`), because the workflow signs in with it.
- **Roll back:** revert the change on main. A release that fails to start is rolled back on the VM automatically.
- **Logs:** `gcloud compute instances get-serial-port-output scopit-community --zone us-east1-b | grep community-agent` shows installs. On the VM (`gcloud compute ssh scopit-community --zone us-east1-b`): `journalctl -u answer` and `journalctl -u caddy`.
- **Restore from a snapshot:** stop the VM, create a disk from a snapshot (Compute Engine > Snapshots > Create disk), swap it in as the boot disk, start the VM.

## Files

| File | What it does |
| --- | --- |
| `gcp-setup.sh` | One-time setup in Cloud Shell: APIs, VM, static IP, firewall, snapshots, bucket, secrets, service accounts, GitHub link |
| `vm-startup.sh` | The VM's startup script: a timer that checks the bucket for a new release |
| `vm-agent.sh` | Run on the VM for each release: machine setup, first install, upgrade, restart, rollback |
| `gcp.env` | Project ID and number, domain, zone (not secret) |
