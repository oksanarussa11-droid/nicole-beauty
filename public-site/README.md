# Nicole Beauty Public Site

This is the Next.js frontend for the Nicole Beauty public-facing website.

## Setup

1. Run `npm install` to install dependencies.
2. Copy `.env.local.example` to `.env.local` and fill in the values.
3. Run `npm run dev` to start the local development server.

## Deployment

This site should be deployed as a **separate Vercel project** from the main admin repository. 
When configuring the Vercel project:
- Set the **Root Directory** to `public-site`.
- Configure all environment variables listed in `.env.local.example`.
