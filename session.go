//go:build js && wasm && !checker
// +build js,wasm,!checker

package main

import (
	"fmt"
	"strconv"
	"strings"
	"syscall/js"

	tg "github.com/amarnathcjd/gogram/telegram"
)

var (
	defaultAppID   = tdesktopAppID
	defaultAppHash = tdesktopAppHash
)

func main() {
	done := make(chan struct{})
	js.Global().Set("generateSession", js.FuncOf(generateSession))
	fmt.Println("Session generator ready")
	<-done
}

func generateSession(this js.Value, args []js.Value) interface{} {
	go func() {
		client := (*tg.Client)(nil)
		defer func() {
			if client != nil {
				_ = client.Terminate()
			}
		}()

		appID, appHash, phoneNumber, botToken, dcID := parseSessionArgs(args)
		fmt.Printf("Using APP_ID: %d\n", appID)
		fmt.Printf("Using APP_HASH: %s\n", maskSecret(appHash, 8))
		if botToken != "" {
			fmt.Printf("Bot token: %s\n", maskSecret(botToken, 10))
		} else {
			fmt.Printf("Phone number: %s\n", phoneNumber)
		}
		fmt.Printf("Requested DC: %d\n", dcID)
		fmt.Printf("Spoofing as: %s / %s / v%s / lang_pack=%s\n",
			tdesktopDeviceModel, tdesktopSystemVersion, tdesktopAppVersion, tdesktopLangPack)

		cfg := tg.NewClientConfigBuilder(int32(appID), appHash).
			WithMemorySession().
			WithCache(tg.NewCache("mem_cache", &tg.CacheConfig{Memory: true})).
			WithDataCenter(dcID).
			Build()
		cfg.UseWebSocket = true
		cfg.UseWebSocketTLS = true
		applySpoof(&cfg)

		var err error
		client, err = tg.NewClient(cfg)
		if err != nil {
			reportSessionResult(false, "", "", fmt.Sprintf("failed to create client: %v", err))
			return
		}

		fmt.Println("Client created successfully")

		if botToken != "" {
			if err = client.LoginBot(botToken); err != nil {
				reportSessionResult(false, "", "", fmt.Sprintf("bot login failed: %v", err))
				return
			}
		} else {
			_, err = client.Login(phoneNumber, &tg.LoginOptions{
				CodeCallback: func() (string, error) {
					fmt.Println("PROMPT_CODE")
					code := waitForInput("code")
					fmt.Printf("Received code: %s\n", code)
					return code, nil
				},
				PasswordCallback: func() (string, error) {
					fmt.Println("PROMPT_PASSWORD")
					password := waitForInput("password")
					fmt.Println("Received password")
					return password, nil
				},
			})
			if err != nil {
				reportSessionResult(false, "", "", fmt.Sprintf("login failed: %v", err))
				return
			}
		}

		me := client.Me()
		fullName := buildFullName(me.FirstName, me.LastName)
		session := client.ExportSession()

		fmt.Printf("SESSION_SUCCESS: %s\n", fullName)
		reportSessionResult(true, session, fullName, "")
	}()

	return nil
}

func parseSessionArgs(args []js.Value) (int, string, string, string, int) {
	appID := defaultAppID
	appHash := defaultAppHash
	phoneNumber := ""
	botToken := ""
	dcID := 5

	if len(args) > 0 && isUsable(args[0]) {
		if parsed, err := strconv.Atoi(strings.TrimSpace(args[0].String())); err == nil && parsed > 0 {
			appID = parsed
		}
	}

	if len(args) > 1 && isUsable(args[1]) {
		value := strings.TrimSpace(args[1].String())
		if value != "" {
			appHash = value
		}
	}

	if len(args) > 2 && isUsable(args[2]) {
		phoneNumber = strings.TrimSpace(args[2].String())
	}

	if len(args) > 3 && isUsable(args[3]) {
		botToken = strings.TrimSpace(args[3].String())
	}

	if len(args) > 4 && isUsable(args[4]) {
		if parsed, err := strconv.Atoi(strings.TrimSpace(args[4].String())); err == nil && parsed > 0 {
			dcID = parsed
		}
	}

	return appID, appHash, phoneNumber, botToken, dcID
}

func reportSessionResult(success bool, session, fullName, errMsg string) {
	payload := map[string]interface{}{
		"success":  success,
		"session":  session,
		"fullName": fullName,
	}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	js.Global().Call("onSessionGenerated", payload)
}
