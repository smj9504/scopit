// Package detect finds personal details and off-site contact requests in a
// post. It has no Answer imports, so it is tested with the standard library
// alone; the plugin in the parent directory wires it into Answer's reviewer.
package detect

import (
	"regexp"
	"strings"
	"unicode"
)

// Finding is one kind of personal or risky detail found in a post.
type Finding string

const (
	FindingPhone         Finding = "phone"
	FindingEmail         Finding = "email"
	FindingClaimOrPolicy Finding = "claim_or_policy_number"
	FindingStreetAddress Finding = "street_address"
	FindingSSN           Finding = "ssn"
	FindingOffSite       Finding = "off_site_contact"
)

var (
	emailRe = regexp.MustCompile(`(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`)

	// US and Canada: 703-555-0142, (703) 555 0142, +1 703.555.0142, 7035550142.
	// The digits must not be part of a longer number (question ids, amounts).
	usPhoneRe = regexp.MustCompile(`(?:^|[^\d])(?:\+?1[\s.\-]?)?\(?[2-9]\d{2}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(?:[^\d]|$)`)

	// Korean mobile numbers: 010-1234-5678.
	krPhoneRe = regexp.MustCompile(`(?:^|[^\d])01[016789][\s.\-]?\d{3,4}[\s.\-]?\d{4}(?:[^\d]|$)`)

	ssnRe = regexp.MustCompile(`(?:^|[^\d])\d{3}-\d{2}-\d{4}(?:[^\d]|$)`)

	// Claim or policy keywords. hasClaimOrPolicyNumber looks at the text right
	// after each one for an id-like token ("claim number is CLM-2026-014233").
	claimKeywordRe = regexp.MustCompile(`(?i)claim|policy|pol\.|클레임|청구|증권|理赔|保单|索赔|reclamo|reclamación|póliza|poliza`)
	idTokenRe      = regexp.MustCompile(`[A-Za-z0-9\-]+`)

	// A US street address: house number, up to four words, street type.
	streetRe = regexp.MustCompile(`(?i)\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s+){0,4}?(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|terrace|ter|circle|cir|parkway|pkwy|highway|hwy|trail|trl)\b`)
)

// DefaultOffSitePhrases are requests to move a conversation off the site.
// Private follow-up is where adjuster and contractor solicitation happens, so
// these posts wait for a moderator.
var DefaultOffSitePhrases = []string{
	"call me", "text me", "dm me", "email me", "message me", "contact me at",
	"whatsapp", "kakao", "wechat",
	"카톡", "카카오톡", "연락주세요", "연락 주세요", "문자 주세요", "전화 주세요", "개인 메시지",
	"微信", "加我", "私信",
	"llámame", "llamame", "escríbeme", "escribeme",
}

// Options controls which checks run.
type Options struct {
	PersonalInfo  bool
	OffSite       bool
	ExtraPhrases  []string
	OffSiteCustom []string // replaces DefaultOffSitePhrases when non-empty
}

// Detect returns the kinds of personal or risky details in text, in a stable
// order, without duplicates.
func Detect(text string, opts Options) []Finding {
	var found []Finding
	add := func(f Finding) {
		for _, x := range found {
			if x == f {
				return
			}
		}
		found = append(found, f)
	}

	if opts.PersonalInfo {
		if usPhoneRe.MatchString(text) || krPhoneRe.MatchString(text) {
			add(FindingPhone)
		}
		if emailRe.MatchString(text) {
			add(FindingEmail)
		}
		if hasClaimOrPolicyNumber(text) {
			add(FindingClaimOrPolicy)
		}
		if streetRe.MatchString(text) {
			add(FindingStreetAddress)
		}
		if ssnRe.MatchString(text) {
			add(FindingSSN)
		}
	}

	if opts.OffSite {
		phrases := DefaultOffSitePhrases
		if len(opts.OffSiteCustom) > 0 {
			phrases = opts.OffSiteCustom
		}
		phrases = append(append([]string{}, phrases...), opts.ExtraPhrases...)
		lower := strings.ToLower(text)
		for _, p := range phrases {
			p = strings.ToLower(strings.TrimSpace(p))
			if p != "" && strings.Contains(lower, p) {
				add(FindingOffSite)
				break
			}
		}
	}
	return found
}

// claimWindow is how far after a keyword an id may appear, in characters.
const claimWindow = 40

// hasClaimOrPolicyNumber looks for a token of at least six characters with at
// least five digits shortly after a claim or policy keyword, so "claim for
// $14,000", "filed a claim 2 weeks ago", and "policy renewal in 2026" pass.
func hasClaimOrPolicyNumber(text string) bool {
	for _, loc := range claimKeywordRe.FindAllStringIndex(text, -1) {
		after := []rune(text[loc[1]:])
		if len(after) > claimWindow {
			after = after[:claimWindow]
		}
		for _, token := range idTokenRe.FindAllString(string(after), -1) {
			digits := 0
			for _, r := range token {
				if unicode.IsDigit(r) {
					digits++
				}
			}
			if len(token) >= 6 && digits >= 5 {
				return true
			}
		}
	}
	return false
}

// SplitLines turns a textarea value into trimmed, non-empty lines.
func SplitLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			out = append(out, t)
		}
	}
	return out
}
