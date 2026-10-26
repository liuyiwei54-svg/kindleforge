import type zh from './zh';

/**
 * The dictionary shape is derived from the Chinese dictionary, so English must
 * expose exactly the same keys and value kinds. Missing translations fail tsc.
 */
export type Dict = typeof zh;

export type CompareRow = Dict['compare']['rows'][number];
export type FaqItem = Dict['faq']['items'][number];
export type ErrorCode = keyof Dict['errors'];
