'use client';
import { createContext, useContext } from 'react';
import type { User } from '@/types';

// The signed-in portal user, provided by the (admin) layout so the Sidebar (and any
// page) can gate on role/tags without refetching. See src/lib/portalAccess.ts.
export interface AccessValue { user: User | null }

const AccessContext = createContext<AccessValue>({ user: null });

export const AccessProvider = AccessContext.Provider;
export function useAccess(): AccessValue { return useContext(AccessContext); }
