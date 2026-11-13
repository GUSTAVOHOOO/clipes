import { createContext, useContext } from 'react';
export type Language = 'pt-BR' | 'en';
export const LanguageContext = createContext<Language>('pt-BR');
export function useText<T extends Record<Language, object>>(texts: T): T[Language] { return texts[useContext(LanguageContext)]; }
