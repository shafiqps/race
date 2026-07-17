# Keyrush deployment

The production service runs as the unprivileged `keyrush` user from `/srv/keyrush`.
Caddy terminates public HTTPS and proxies HTTP/WebSocket traffic to the Node server
on `127.0.0.1:3001`. Only TCP ports 80 and 443 are intended to be public.

Deploy a new build between active matches because rooms are held in memory:

```sh
npm ci
npm test
npm run build
sudo install -d -o root -g keyrush -m 0750 /srv/keyrush /srv/keyrush/dist /srv/keyrush/dist-server
sudo cp -a dist/. /srv/keyrush/dist/
sudo cp -a dist-server/. /srv/keyrush/dist-server/
sudo chown -R root:keyrush /srv/keyrush
sudo chmod -R u=rwX,g=rX,o= /srv/keyrush
sudo systemctl restart keyrush
curl --fail http://127.0.0.1:3001/health
```
