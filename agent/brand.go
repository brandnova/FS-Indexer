package main

// The one place the brand credit and the support contacts live. Used by -version, the terminal
// and the dashboard. (The app has its own copy in mobile/src/brand.ts.)
const (
	brandName = "Brand Nova"
	brandURL  = "https://brandnova.pythonanywhere.com" // temporary address: change it here when the final one exists
	brandLine = "Made by " + brandName

	supportEmail = "brandnova.dev@gmail.com"
	issuesURL    = "https://github.com/brandnova/perigee-files/issues" // follows the repository's name
)
