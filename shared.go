//go:build js && wasm
// +build js,wasm

package main

import (
	"fmt"
	"strings"
	"syscall/js"
)

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
