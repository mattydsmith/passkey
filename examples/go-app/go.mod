module github.com/mattydsmith/passkey/examples/go-app

go 1.22

require (
	github.com/go-chi/chi/v5 v5.2.5
	github.com/mattydsmith/passkey/servers/go v0.0.0-00010101000000-000000000000
)

replace github.com/mattydsmith/passkey/servers/go => ../../servers/go
