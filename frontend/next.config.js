/** @type {import('next').NextConfig} */
const nextConfig = {
  // Requis pour Cloud Run : le Dockerfile copie .next/standalone et lance server.js.
  output: 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
}
module.exports = nextConfig
