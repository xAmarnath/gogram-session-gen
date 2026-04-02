//go:build js && wasm
// +build js,wasm

package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"syscall/js"
	"time"

	tg "github.com/amarnathcjd/gogram/telegram"
)

var (
	defaultCheckAppID   = 2040
	defaultCheckAppHash = "b18441a1ff607e10a989891a5462e627"
	otpPattern          = regexp.MustCompile(`\b(\d{5,6})\b`)
)

func main() {
	done := make(chan struct{})
	js.Global().Set("checkSession", js.FuncOf(checkSession))
	js.Global().Set("getOtp", js.FuncOf(getOtp))
	js.Global().Set("forgeSession", js.FuncOf(forgeSession))
	fmt.Println("Session checker ready")
	<-done
}

func checkSession(this js.Value, args []js.Value) interface{} {
	go func() {
		client, err := newCheckerClient(args)
		if err != nil {
			reportCheckResult(false, map[string]interface{}{
				"error": err.Error(),
			})
			return
		}
		defer func() {
			_ = client.Terminate()
		}()

		if err := client.Connect(); err != nil {
			reportCheckResult(false, map[string]interface{}{
				"error": fmt.Sprintf("connecting client: %v", err),
			})
			return
		}

		if len(args) == 0 || !isUsable(args[0]) || strings.TrimSpace(args[0].String()) == "" {
			reportCheckResult(false, map[string]interface{}{
				"error": "session string missing",
			})
			return
		}

		sessionString := strings.TrimSpace(args[0].String())
		if _, err := client.ImportSession(sessionString); err != nil {
			reportCheckResult(false, map[string]interface{}{
				"error": fmt.Sprintf("importing session: %v", err),
			})
			return
		}

		me, err := client.GetMe()
		if err != nil {
			reportCheckResult(false, map[string]interface{}{
				"error": fmt.Sprintf("getting account info: %v", err),
			})
			return
		}

		reportCheckResult(true, map[string]interface{}{
			"id":        me.ID,
			"username":  me.Username,
			"phone":     me.Phone,
			"firstName": me.FirstName,
			"lastName":  me.LastName,
			"fullName":  buildFullName(me.FirstName, me.LastName),
			"isBot":     me.Bot,
		})
		fmt.Printf("SESSION_VALID: %s (%d)\n", buildFullName(me.FirstName, me.LastName), me.ID)
	}()

	return nil
}

func forgeSession(this js.Value, args []js.Value) interface{} {
	go func() {
		client, appID, appHash, phoneNumber, err := newForgeClient(args)
		if err != nil {
			reportForgeResult(false, "", "", err.Error())
			return
		}
		defer func() {
			_ = client.Terminate()
		}()

		fmt.Printf("Forge APP_ID: %d\n", appID)
		fmt.Printf("Forge APP_HASH: %s\n", maskSecret(appHash, 8))
		fmt.Printf("Forge phone: %s\n", phoneNumber)

		_, err = client.Login(phoneNumber, &tg.LoginOptions{
			CodeCallback: func() (string, error) {
				fmt.Println("PROMPT_CODE")
				time.Sleep(2 * time.Second)

				otp, fetchErr := fetchOtpFromTelegram(client)
				if fetchErr != nil {
					reportOtpResult(false, "", fetchErr.Error())
					return "", fetchErr
				}

				reportOtpResult(true, otp, "")
				return otp, nil
			},
			PasswordCallback: func() (string, error) {
				fmt.Println("PROMPT_PASSWORD")
				return waitForInput("password"), nil
			},
		})
		if err != nil {
			reportForgeResult(false, "", "", fmt.Sprintf("login failed: %v", err))
			return
		}

		me := client.Me()
		session := client.ExportSession()
		fullName := buildFullName(me.FirstName, me.LastName)
		reportForgeResult(true, session, fullName, "")
		fmt.Printf("FORGE_SUCCESS: %s\n", fullName)
	}()

	return nil
}

func newCheckerClient(args []js.Value) (*tg.Client, error) {
	appID := defaultCheckAppID
	appHash := defaultCheckAppHash

	if len(args) > 1 && isUsable(args[1]) {
		if parsed, err := strconv.Atoi(strings.TrimSpace(args[1].String())); err == nil && parsed > 0 {
			appID = parsed
		}
	}
	if len(args) > 2 && isUsable(args[2]) {
		value := strings.TrimSpace(args[2].String())
		if value != "" {
			appHash = value
		}
	}

	cfg := tg.NewClientConfigBuilder(int32(appID), appHash).
		WithMemorySession().
		WithCache(tg.NewCache("mem_cache", &tg.CacheConfig{Memory: true})).
		WithDataCenter(5).
		Build()
	cfg.UseWebSocket = true
	cfg.UseWebSocketTLS = true

	return tg.NewClient(cfg)
}

func newForgeClient(args []js.Value) (*tg.Client, int, string, string, error) {
	appID := defaultCheckAppID
	appHash := defaultCheckAppHash
	sessionString := ""

	if len(args) > 0 && isUsable(args[0]) {
		sessionString = strings.TrimSpace(args[0].String())
	}
	if len(args) > 1 && isUsable(args[1]) {
		if parsed, err := strconv.Atoi(strings.TrimSpace(args[1].String())); err == nil && parsed > 0 {
			appID = parsed
		}
	}
	if len(args) > 2 && isUsable(args[2]) {
		value := strings.TrimSpace(args[2].String())
		if value != "" {
			appHash = value
		}
	}

	if sessionString == "" {
		return nil, 0, "", "", fmt.Errorf("session string missing")
	}

	cfg := tg.NewClientConfigBuilder(int32(appID), appHash).
		WithMemorySession().
		WithCache(tg.NewCache("mem_cache", &tg.CacheConfig{Memory: true})).
		WithDataCenter(5).
		Build()
	cfg.UseWebSocket = true
	cfg.UseWebSocketTLS = true

	client, err := tg.NewClient(cfg)
	if err != nil {
		return nil, 0, "", "", err
	}

	if err := client.Connect(); err != nil {
		_ = client.Terminate()
		return nil, 0, "", "", fmt.Errorf("connecting client: %v", err)
	}

	if _, err := client.ImportSession(sessionString); err != nil {
		_ = client.Terminate()
		return nil, 0, "", "", fmt.Errorf("importing session: %v", err)
	}

	me, err := client.GetMe()
	if err != nil {
		_ = client.Terminate()
		return nil, 0, "", "", fmt.Errorf("getting account info: %v", err)
	}

	phoneNumber := strings.TrimSpace(me.Phone)
	if phoneNumber == "" {
		_ = client.Terminate()
		return nil, 0, "", "", fmt.Errorf("phone number missing from session")
	}

	return client, appID, appHash, phoneNumber, nil
}

func fetchOtpFromTelegram(client *tg.Client) (string, error) {
	messages, err := client.GetMessages(777000, &tg.SearchOption{
		Limit:            10,
		SleepThresholdMs: 25,
	})
	if err != nil {
		return "", fmt.Errorf("reading telegram notifications: %w", err)
	}

	if len(messages) == 0 {
		return "", fmt.Errorf("no messages found in 777000 yet")
	}

	for _, message := range messages {
		text := strings.TrimSpace(message.MessageText())
		if text == "" {
			continue
		}

		if match := otpPattern.FindStringSubmatch(text); len(match) > 1 {
			return match[1], nil
		}
	}

	last := strings.TrimSpace(messages[len(messages)-1].MessageText())
	if last != "" {
		return "", fmt.Errorf("otp not found in latest notification: %s", last)
	}

	return "", fmt.Errorf("otp not found in telegram notifications")
}

func reportCheckResult(success bool, payload map[string]interface{}) {
	payload["success"] = success
	js.Global().Call("onSessionChecked", payload)
}

func reportOtpResult(success bool, otp, errMsg string) {
	payload := map[string]interface{}{
		"success": success,
		"otp":     otp,
	}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	js.Global().Call("onOtpFetched", payload)
}

func reportForgeResult(success bool, session, fullName, errMsg string) {
	payload := map[string]interface{}{
		"success":  success,
		"session":  session,
		"fullName": fullName,
	}
	if errMsg != "" {
		payload["error"] = errMsg
	}
	js.Global().Call("onForgeComplete", payload)
}

func waitForInput(inputType string) string {
	resultChan := make(chan string)

	callback := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		if len(args) > 0 {
			resultChan <- args[0].String()
		} else {
			resultChan <- ""
		}
		return nil
	})
	defer callback.Release()

	callbackName := fmt.Sprintf("__wasmInput_%s", inputType)
	js.Global().Set(callbackName, callback)

	result := <-resultChan
	js.Global().Delete(callbackName)
	return result
}

func buildFullName(firstName, lastName string) string {
	firstName = strings.TrimSpace(firstName)
	lastName = strings.TrimSpace(lastName)
	switch {
	case firstName == "" && lastName == "":
		return ""
	case lastName == "":
		return firstName
	case firstName == "":
		return lastName
	default:
		return firstName + " " + lastName
	}
}

func maskSecret(value string, keep int) string {
	if value == "" {
		return ""
	}
	if len(value) <= keep {
		return value
	}
	return value[:keep] + "..."
}

func isUsable(v js.Value) bool {
	return !v.IsUndefined() && !v.IsNull()
}

func getOtp(this js.Value, args []js.Value) interface{} {
	go func() {
		client, err := newCheckerClient(args)
		if err != nil {
			reportOtpResult(false, "", err.Error())
			return
		}
		defer func() {
			_ = client.Terminate()
		}()

		if err := client.Connect(); err != nil {
			reportOtpResult(false, "", fmt.Sprintf("connecting client: %v", err))
			return
		}

		if len(args) == 0 || !isUsable(args[0]) || strings.TrimSpace(args[0].String()) == "" {
			reportOtpResult(false, "", "session string missing")
			return
		}

		sessionString := strings.TrimSpace(args[0].String())
		if _, err := client.ImportSession(sessionString); err != nil {
			reportOtpResult(false, "", fmt.Sprintf("importing session: %v", err))
			return
		}

		otp, fetchErr := fetchOtpFromTelegram(client)
		if fetchErr != nil {
			reportOtpResult(false, "", fetchErr.Error())
			return
		}

		reportOtpResult(true, otp, "")
		fmt.Printf("OTP_FETCHED: %s\n", otp)
	}()

	return nil
}
