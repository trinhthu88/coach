import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scrolls to the element whose id matches the URL hash once `ready` is true
 * (i.e. after the page has rendered the data that contains the anchor).
 * React Router does not do this for client-side navigations.
 */
export function useHashScroll(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, ready]);
}
