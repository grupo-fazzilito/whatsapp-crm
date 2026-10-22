import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { DEFAULT_THEME, LEGACY_STORAGE_KEYS, MODE_STORAGE_KEY, STORAGE_KEY, THEME_IDS } from "@/lib/themes";
import { getLocale } from "@/i18n/server";
import { COMPANY } from "@/lib/company";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/+$/, "");

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Default title and description (app pages; public pages set their own per language).
const SITE_TITLE = "Whasalia — CRM gratis para WhatsApp, Instagram y Messenger con IA";
const SITE_DESCRIPTION = "CRM gratuito para siempre: bandeja compartida, agentes de IA, flujos, ventas y reservas para WhatsApp, Instagram y Messenger. Solo pagas los tokens de IA que usas.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s — Whasalia",
  },
  description: SITE_DESCRIPTION,
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "Whasalia",
    images: [
      {
        url: `${SITE_URL}/images/logo/whasalia-logo-light.png`,
        width: 1544,
        height: 338,
        alt: "Whasalia CRM Logo",
      },
    ],
    locale: "es_PE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [`${SITE_URL}/images/logo/whasalia-logo-light.png`],
  },
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark",
};

// Inline boot script — runs before React hydrates so the user's
// chosen theme is on the <html> element before first paint. Without
// this every page load flashes the default Violet for a frame before
// the React tree mounts and applies the picked theme.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid theme IDs
// is sourced from the THEME_IDS constant so adding a theme doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  try {
    var LEGACY = ${JSON.stringify(LEGACY_STORAGE_KEYS)};
    for (var oldKey in LEGACY) {
      var v = localStorage.getItem(oldKey);
      if (v !== null) {
        if (localStorage.getItem(LEGACY[oldKey]) === null) localStorage.setItem(LEGACY[oldKey], v);
        localStorage.removeItem(oldKey);
      }
    }
  } catch (_e) {}
  try {
    var STORAGE_KEY = ${JSON.stringify(STORAGE_KEY)};
    var DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var ALLOWED = ${JSON.stringify(THEME_IDS)};
    var saved = localStorage.getItem(STORAGE_KEY);
    var theme = ALLOWED.indexOf(saved) !== -1 ? saved : DEFAULT;
    document.documentElement.dataset.theme = theme;
  } catch (_e) {
    document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
  }
  
  try {
    var savedMtheme = localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY)});
    var mtheme = "dark";
    if (savedMtheme === "light" || savedMtheme === "dark") {
      mtheme = savedMtheme;
    }
    // No system preference fallback — dark is always the default
    document.documentElement.setAttribute("data-mtheme", mtheme);
    if (mtheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  } catch (_e) {
    document.documentElement.setAttribute("data-mtheme", "dark");
    document.documentElement.classList.add("dark");
  }
})();
`;


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mtheme="dark"
      className={`${inter.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Theme boot — runs before first paint to avoid flash.
            Rendered as a raw script element in the server HTML;
            React never re-executes it on the client. */}
        <script
          id="theme-boot"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
          suppressHydrationWarning
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Whasalia",
              "alternateName": "Whasalia",
              "url": SITE_URL,
              "logo": `${SITE_URL}/images/logo/whasalia-logo-light.png`,
              "legalName": COMPANY.legalName,
              "taxID": COMPANY.taxId,
              "email": COMPANY.email,
              "contactPoint": {
                "@type": "ContactPoint",
                "email": COMPANY.email,
                "contactType": "customer service",
                "availableLanguage": ["es", "en"]
              },
              "address": {
                "@type": "PostalAddress",
                "streetAddress": COMPANY.street,
                "addressLocality": COMPANY.city,
                "addressRegion": COMPANY.region,
                "postalCode": COMPANY.postalCode,
                "addressCountry": "PE"
              },
              "description": SITE_DESCRIPTION
            })
          }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans" suppressHydrationWarning>
        <ThemeProvider>
          {children}
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              style: {
                background: "rgb(30 41 59)",
                border: "1px solid rgb(51 65 85)",
                color: "white",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
