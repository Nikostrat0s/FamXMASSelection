# Family Christmas Gift Draw

## What the app does
Each person draws 2 different family members. Everyone is picked exactly twice, nobody draws themselves, and the draw needs at least 3 people.

## How it works
The organizer uses `/admin` to add names. Each person logs in with their name and a PIN they make up, then rolls twice and sees only their own names. The list locks on the first roll. The organizer page includes “Who has who”, Reset PIN, and Start over.

## Deploy to Railway
Push the project to a GitHub repo and connect it to a Railway service. Set `ADMIN_PASSWORD` and `SESSION_SECRET` as variables. Add a volume mounted at `/data` and set `DATA_DIR=/data`. Generate a domain, and set the health check path to `/health`.

## Run locally
Run `npm start` to start the server and `npm test` to check the draw rules.
