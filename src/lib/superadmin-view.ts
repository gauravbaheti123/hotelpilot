import { useEffect, useState } from "react";

const SS_KEY = "hp.superadminViewingPropertyId";
const EVT = "hp:superadmin-view-changed";
const LS_PROPERTY = "hp.currentPropertyId";
const PROP_EVT = "hp:property-changed";

export function getViewingPropertyId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(SS_KEY);
  } catch {
    return null;
  }
}

export function enterViewMode(propertyId: string) {
  try {
    sessionStorage.setItem(SS_KEY, propertyId);
    localStorage.setItem(LS_PROPERTY, propertyId);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
  window.dispatchEvent(new Event(PROP_EVT));
}

export function exitViewMode() {
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

export function useSuperadminView() {
  const [id, setId] = useState<string | null>(() => getViewingPropertyId());
  useEffect(() => {
    const handler = () => setId(getViewingPropertyId());
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);
  return { viewingPropertyId: id, isViewing: !!id, exit: exitViewMode };
}