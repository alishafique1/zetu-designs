import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { I18nProvider } from '../src/i18n';
import '../src/index.css';

export const metadata: Metadata = {
  title: 'Zetu Designs',
  icons: {
    icon: '/logo.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#F4EFE6',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body>
        <ClerkProvider>
          <I18nProvider>{children}</I18nProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
