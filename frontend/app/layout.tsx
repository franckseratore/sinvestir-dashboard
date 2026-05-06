import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Sidebar } from '@/components/sidebar'
import { Suspense } from 'react'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: "Dashboard S'investir",
  description: "Pilotage marketing & sales S'investir",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <NuqsAdapter>
          <Suspense>
            <div className="flex h-screen overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-y-auto bg-[#FAFAF7]">
                <div className="p-8 min-h-full">
                  {children}
                </div>
              </main>
            </div>
          </Suspense>
        </NuqsAdapter>
      </body>
    </html>
  )
}
