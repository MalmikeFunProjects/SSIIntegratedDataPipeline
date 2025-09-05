package websocket

import (
	"log"
	"net/http"
	// "time"

	"github.com/gorilla/websocket"

	"data_synthesizer/service/metrics"
)

var clients = make(map[*websocket.Conn]bool)
var Broadcast = make(chan []byte)

var upgrader = websocket.Upgrader{}

func HandleWebSocket(w http.ResponseWriter, r *http.Request) {
    upgrader.CheckOrigin = func(r *http.Request) bool { return true }
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("WebSocket upgrade failed: %v", err)
        return
    }
    defer func() {
		conn.Close()
		metrics.WebsocketConnectionsActive.Dec()
	}()
    clients[conn] = true
    metrics.WebsocketConnectionsActive.Inc()

    for {
        _, _, err := conn.ReadMessage()
        if err != nil {
            delete(clients, conn)
            break
        }
    }
}

func init() {
    go func() {
        for {
            msg := <-Broadcast
            for client := range clients {
                // time.Sleep(time.Duration(3000) * time.Millisecond)
                err := client.WriteMessage(websocket.TextMessage, msg)
                if err != nil {
                    log.Printf("Error writing to WebSocket: %v", err)
                    client.Close()
                    delete(clients, client)
                }
            }
        }
    }()
}
