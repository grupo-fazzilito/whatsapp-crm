import { cn } from "@/lib/utils";

/**
 * The Whasalia wordmark: dark text in light mode, white text in dark mode.
 * Both images are in the HTML and CSS shows the one matching the theme
 * actually applied (<html data-mtheme>), so it is right from the first paint
 * and whichever provider changed the theme.
 */
export function Logo({ className, alt = "Whasalia" }: { className?: string; alt?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/images/logo/whasalia-logo.png" alt={alt} width={758} height={240} className={cn("w-auto object-contain [[data-mtheme=light]_&]:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/images/logo/whasalia-logo-light.png" alt={alt} width={758} height={240} className={cn("hidden w-auto object-contain [[data-mtheme=light]_&]:block", className)} />
    </>
  );
}
