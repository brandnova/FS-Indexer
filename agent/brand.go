package main

// The one place the brand credit, the support contacts and the repository live. Used by -version, the
// terminal, the dashboard and the update check. (The app has its own copy in mobile/src/brand.ts.)
const (
	brandName = "Brand Nova"
	brandURL  = "https://brandnova.pythonanywhere.com" // temporary address: change it here when the final one exists
	brandLine = "Made by " + brandName

	supportEmail = "brandnova.dev@gmail.com"
	githubRepo   = "brandnova/perigee-files" // follows the repository's name
	issuesURL    = "https://github.com/" + githubRepo + "/issues"
)