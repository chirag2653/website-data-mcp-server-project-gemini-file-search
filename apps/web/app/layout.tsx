import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Website Ingestion Service',
  description: 'Ingest and index websites for semantic search',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

