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

	js.Global().Set("checkSession", js.FuncOf(checkSession))

	fmt.Println("Session checker ready")
	<-done
}

func checkSession(this js.Value, args []js.Value) interface{} {
	go func() {

		if len(args) == 0 || args[0].IsUndefined() || args[0].IsNull() {
			js.Global().Call("onSessionChecked", map[string]interface{}{
				"success": false,
				"error":   "session string missing",
			})
			return
		}

		sessionString := args[0].String()
		appID := defaultAppID
		appHash := defaultAppHash

		if len(args) > 1 && !args[1].IsUndefined() && !args[1].IsNull() {
			fmt.Sscanf(args[1].String(), "%d", &appID)
		}
		if len(args) > 2 && !args[2].IsUndefined() && !args[2].IsNull() {
			appHash = args[2].String()
		}

		cfg := tg.NewClientConfigBuilder(int32(appID), appHash).
			WithSessionString(sessionString).
			WithMemorySession().
			WithCache(tg.NewCache("mem_cache", &tg.CacheConfig{
				Memory: true,
			})).
			Build()

		cfg.UseWebSocket = true
		cfg.UseWebSocketTLS = true

		client, err := tg.NewClient(cfg)
		if err != nil {
			js.Global().Call("onSessionChecked", map[string]interface{}{
				"success": false,
				"error":   fmt.Sprintf("client creation failed: %v", err),
			})
			return
		}

		defer client.Terminate()

		me, err := client.GetMe()
		if err != nil {
			js.Global().Call("onSessionChecked", map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			})
			return
		}

		fullName := me.FirstName
		if me.LastName != "" {
			fullName += " " + me.LastName
		}

		js.Global().Call("onSessionChecked", map[string]interface{}{
			"success":   true,
			"id":        me.ID,
			"username":  me.Username,
			"firstName": me.FirstName,
			"lastName":  me.LastName,
			"fullName":  fullName,
			"isBot":     me.Bot,
		})

		fmt.Printf("SESSION_VALID: %s (%d)\n", fullName, me.ID)
	}()

	return nil
}
