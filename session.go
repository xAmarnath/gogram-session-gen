//go:build js && wasm
// +build js,wasm

package main

import (
	"fmt"
	"syscall/js"

	tg "github.com/amarnathcjd/gogram/telegram"
)

var (
	defaultAppID   = 2040
	defaultAppHash = "b18441a1ff607e10a989891a5462e627"
)

func main() {
	done := make(chan struct{})

	js.Global().Set("generateSession", js.FuncOf(generateSession))

	fmt.Println("Session generator ready")
	<-done
}

func generateSession(this js.Value, args []js.Value) interface{} {
	go func() {

		appID := defaultAppID
		appHash := defaultAppHash
		phoneNumber := ""

		if len(args) > 0 && !args[0].IsNull() && !args[0].IsUndefined() {
			inputAppID := args[0].String()
			if inputAppID != "" {
				fmt.Sscanf(inputAppID, "%d", &appID)
			}
		}

		if len(args) > 1 && !args[1].IsNull() && !args[1].IsUndefined() {
			inputHash := args[1].String()
			if inputHash != "" {
				appHash = inputHash
			}
		}

		if len(args) > 2 && !args[2].IsNull() && !args[2].IsUndefined() {
			phoneNumber = args[2].String()
		}

		if phoneNumber == "" {
			fmt.Println("ERROR: Phone number is required")
			return
		}

		fmt.Printf("Using APP_ID: %d\n", appID)
		fmt.Printf("Using APP_HASH: %s\n", appHash[:8]+"...")
		fmt.Printf("Phone number: %s\n", phoneNumber)

		cfg := tg.NewClientConfigBuilder(int32(appID), appHash).
			WithMemorySession().
			WithCache(tg.NewCache("mem_cache", &tg.CacheConfig{
				Memory: true,
			})).
			Build()

		cfg.UseWebSocket = true
		cfg.UseWebSocketTLS = true

		client, err := tg.NewClient(cfg)
		if err != nil {
			fmt.Printf("ERROR: Failed to create client: %v\n", err)
			return
		}

		fmt.Println("Client created successfully")

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
			fmt.Printf("ERROR: Login failed: %v\n", err)
			return
		}

		fmt.Println("Login successful!")

		me := client.Me()

		firstName := me.FirstName
		lastName := me.LastName
		fullName := firstName
		if lastName != "" {
			fullName = firstName + " " + lastName
		}

		session := client.ExportSession()

		result := map[string]interface{}{
			"success":   true,
			"session":   session,
			"firstName": firstName,
			"lastName":  lastName,
			"fullName":  fullName,
		}

		js.Global().Call("onSessionGenerated", result)
		fmt.Printf("SESSION_SUCCESS: %s\n", fullName)
		fmt.Printf("SESSION: %s\n", session)
	}()

	return nil
}

func waitForInput(inputType string) string {
	resultChan := make(chan string)

	callback := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		if len(args) > 0 {
			resultChan <- args[0].String()
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
