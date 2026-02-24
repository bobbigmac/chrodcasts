import { h, render } from "https://esm.sh/preact@10.19.6";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "https://esm.sh/preact@10.19.6/hooks";
import * as Signals from "https://esm.sh/@preact/signals@1.2.3";
import htm from "https://esm.sh/htm@3.1.1";

export const html = htm.bind(h);

export { h, render, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState };
export const { signal, computed, effect, batch, untracked, Signal, useSignal, useComputed, useSignalEffect } = Signals;
