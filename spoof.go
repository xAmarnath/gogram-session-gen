//go:build js && wasm
// +build js,wasm

package main

import (
	tg "github.com/amarnathcjd/gogram/telegram"
)

// Hardcoded Telegram Desktop v6.9.2 (Windows x64) fingerprint.
// These are the exact fields the official tdesktop client sends via
// initConnection at layer 227.
const (
	tdesktopAppID          = 2040
	tdesktopAppHash        = "b18441a1ff607e10a989891a5462e627"
	tdesktopDeviceModel    = "Desktop"
	tdesktopSystemVersion  = "Windows 11 (build 26200)"
	tdesktopAppVersion     = "6.9.2 x64"
	tdesktopLangCode       = "en"
	tdesktopSystemLangCode = "en-US"
	tdesktopLangPack       = "tdesktop"
	// tz_offset in seconds — UTC (0). Rounded to nearest 15 min,
	// within [-12h, +14h] as tdesktop does before sending.
	tdesktopTzOffset = 0
)

// tdesktopParams builds the extra initConnection JSON object that
// tdesktop sends, currently only the tz_offset field.
func tdesktopParams() tg.JsonValue {
	return &tg.JsonObject{
		Value: []*tg.JsonObjectValue{
			{
				Key:   "tz_offset",
				Value: &tg.JsonNumber{Value: float64(tdesktopTzOffset)},
			},
		},
	}
}

// applySpoof overwrites the DeviceConfig on the given ClientConfig so
// the WASM client identifies itself as the official Telegram Desktop
// v6.9.2 (Windows x64). Call this AFTER Build() and before NewClient().
func applySpoof(cfg *tg.ClientConfig) {
	cfg.DeviceConfig = tg.DeviceConfig{
		DeviceModel:    tdesktopDeviceModel,
		SystemVersion:  tdesktopSystemVersion,
		AppVersion:     tdesktopAppVersion,
		LangCode:       tdesktopLangCode,
		SystemLangCode: tdesktopSystemLangCode,
		LangPack:       tdesktopLangPack,
		Params:         tdesktopParams(),
	}
}
