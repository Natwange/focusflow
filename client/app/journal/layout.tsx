import type { ReactNode } from "react";

/** Journal handwriting fonts — only loaded on journal routes (not app-wide). */
export default function JournalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Kalam:wght@300;400;700&family=Nanum+Pen+Script&family=Patrick+Hand&display=swap"
        rel="stylesheet"
      />
      {children}
    </>
  );
}
