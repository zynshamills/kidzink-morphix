import { Fraunces, Poppins } from 'next/font/google';
import './globals.css';

const sans = Poppins({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-sans' });
// Soft display serif for the learning space headlines.
const display = Fraunces({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-display' });

export const metadata = {
  title: 'Kidz Morphix – Learning space in 3D',
  description: 'Step inside a Kidz Morphix learning space built with WebGL. Look around, move between the zones and customise the furniture.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f2f1ee',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
