// Package pii_reviewer is an Apache Answer reviewer plugin for Scopit
// Community. It sends a post to the review queue, instead of publishing it,
// when:
//
//   - the author is a new member (fewer approved posts than the threshold), or
//   - the post looks like it contains personal details (phone, email, claim or
//     policy number, street address, SSN), or
//   - the post asks to move the conversation off the site ("DM me", "카톡").
//
// Admins and moderators are never held. Nothing is deleted automatically: a
// moderator approves or rejects each held post in Admin > Review.
package pii_reviewer

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/apache/answer/plugin"
	"github.com/smj9504/scopit/community/plugins/pii-reviewer/detect"
)

const (
	slugName = "scopit_pii_reviewer"
	i18nBase = "plugin." + slugName + ".backend."

	// Roles as Answer reports them in ReviewContentAuthor.Role.
	roleAdmin     = 2
	roleModerator = 3
)

type config struct {
	HoldNewUserPosts  bool
	NewUserThreshold  int
	CheckPersonalInfo bool
	CheckOffSite      bool
	ExtraPhrases      []string
}

func defaultConfig() config {
	return config{
		HoldNewUserPosts:  true,
		NewUserThreshold:  1,
		CheckPersonalInfo: true,
		CheckOffSite:      true,
	}
}

// Reviewer implements plugin.Reviewer and plugin.Config.
type Reviewer struct {
	cfg config
}

func init() {
	plugin.Register(&Reviewer{cfg: defaultConfig()})
}

func tr(key string) plugin.Translator {
	return plugin.MakeTranslator(i18nBase + key)
}

func (r *Reviewer) Info() plugin.Info {
	return plugin.Info{
		Name:        tr("info.name"),
		SlugName:    slugName,
		Description: tr("info.description"),
		Author:      "Scopit",
		Version:     "0.1.0",
		Link:        "https://github.com/smj9504/scopit/tree/main/community/plugins/pii-reviewer",
	}
}

func (r *Reviewer) Review(content *plugin.ReviewContent) *plugin.ReviewResult {
	approved := &plugin.ReviewResult{Approved: true, ReviewStatus: plugin.ReviewStatusApproved}
	if content == nil {
		return approved
	}
	role := content.Author.Role
	if role == roleAdmin || role == roleModerator {
		return approved
	}

	korean := strings.HasPrefix(content.Language, "ko")
	var reasons []string

	// Answer saves a new post as pending before calling reviewers, so these
	// counts are the author's earlier approved questions and answers.
	prior := content.Author.ApprovedQuestionAmount + content.Author.ApprovedAnswerAmount
	if r.cfg.HoldNewUserPosts && prior < int64(r.cfg.NewUserThreshold) {
		reasons = append(reasons, newMemberReason(korean))
	}

	text := content.Title + "\n" + content.Content
	findings := detect.Detect(text, detect.Options{
		PersonalInfo: r.cfg.CheckPersonalInfo,
		OffSite:      r.cfg.CheckOffSite,
		ExtraPhrases: r.cfg.ExtraPhrases,
	})
	if len(findings) > 0 {
		reasons = append(reasons, findingsReason(findings, korean))
	}

	if len(reasons) == 0 {
		return approved
	}
	return &plugin.ReviewResult{
		Approved:     false,
		ReviewStatus: plugin.ReviewStatusNeedReview,
		Reason:       strings.Join(reasons, " / "),
	}
}

func newMemberReason(korean bool) string {
	if korean {
		return "새 회원의 첫 글"
	}
	return "First post from a new member"
}

var findingLabels = map[detect.Finding][2]string{
	detect.FindingPhone:         {"전화번호", "phone number"},
	detect.FindingEmail:         {"이메일 주소", "email address"},
	detect.FindingClaimOrPolicy: {"클레임·증권 번호", "claim or policy number"},
	detect.FindingStreetAddress: {"집 주소", "street address"},
	detect.FindingSSN:           {"사회보장번호", "Social Security number"},
	detect.FindingOffSite:       {"외부 연락 요청", "request to talk off the site"},
}

func findingsReason(findings []detect.Finding, korean bool) string {
	idx := 1
	prefix := "Looks like it contains: "
	if korean {
		idx = 0
		prefix = "확인 필요: "
	}
	labels := make([]string, 0, len(findings))
	for _, f := range findings {
		labels = append(labels, findingLabels[f][idx])
	}
	return prefix + strings.Join(labels, ", ")
}

// ConfigFields are shown in Admin > Plugins > Scopit PII reviewer.
func (r *Reviewer) ConfigFields() []plugin.ConfigField {
	return []plugin.ConfigField{
		{
			Name:        "hold_new_user_posts",
			Type:        plugin.ConfigTypeSwitch,
			Title:       tr("config.hold_new_user_posts.title"),
			Description: tr("config.hold_new_user_posts.description"),
			Value:       r.cfg.HoldNewUserPosts,
			UIOptions:   plugin.ConfigFieldUIOptions{Label: tr("config.hold_new_user_posts.label")},
		},
		{
			Name:        "new_user_threshold",
			Type:        plugin.ConfigTypeInput,
			Title:       tr("config.new_user_threshold.title"),
			Description: tr("config.new_user_threshold.description"),
			Value:       strconv.Itoa(r.cfg.NewUserThreshold),
			UIOptions:   plugin.ConfigFieldUIOptions{InputType: plugin.InputTypeNumber},
		},
		{
			Name:        "check_personal_info",
			Type:        plugin.ConfigTypeSwitch,
			Title:       tr("config.check_personal_info.title"),
			Description: tr("config.check_personal_info.description"),
			Value:       r.cfg.CheckPersonalInfo,
			UIOptions:   plugin.ConfigFieldUIOptions{Label: tr("config.check_personal_info.label")},
		},
		{
			Name:        "check_off_site",
			Type:        plugin.ConfigTypeSwitch,
			Title:       tr("config.check_off_site.title"),
			Description: tr("config.check_off_site.description"),
			Value:       r.cfg.CheckOffSite,
			UIOptions:   plugin.ConfigFieldUIOptions{Label: tr("config.check_off_site.label")},
		},
		{
			Name:        "extra_phrases",
			Type:        plugin.ConfigTypeTextarea,
			Title:       tr("config.extra_phrases.title"),
			Description: tr("config.extra_phrases.description"),
			Value:       strings.Join(r.cfg.ExtraPhrases, "\n"),
			UIOptions:   plugin.ConfigFieldUIOptions{Rows: "4"},
		},
	}
}

// ConfigReceiver gets the saved settings as a JSON object keyed by field name.
func (r *Reviewer) ConfigReceiver(raw []byte) error {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return err
	}
	cfg := defaultConfig()
	if v, ok := m["hold_new_user_posts"].(bool); ok {
		cfg.HoldNewUserPosts = v
	}
	switch v := m["new_user_threshold"].(type) {
	case float64:
		cfg.NewUserThreshold = int(v)
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			cfg.NewUserThreshold = n
		}
	}
	if cfg.NewUserThreshold < 0 {
		cfg.NewUserThreshold = 0
	}
	if v, ok := m["check_personal_info"].(bool); ok {
		cfg.CheckPersonalInfo = v
	}
	if v, ok := m["check_off_site"].(bool); ok {
		cfg.CheckOffSite = v
	}
	if v, ok := m["extra_phrases"].(string); ok {
		cfg.ExtraPhrases = detect.SplitLines(v)
	}
	r.cfg = cfg
	return nil
}
