package pii_reviewer

import (
	"strings"
	"testing"

	"github.com/apache/answer/plugin"
)

func review(r *Reviewer, role int, prior int64, title, body, lang string) *plugin.ReviewResult {
	return r.Review(&plugin.ReviewContent{
		ObjectType: "question",
		Title:      title,
		Content:    body,
		Language:   lang,
		Author: plugin.ReviewContentAuthor{
			Role:                   role,
			ApprovedQuestionAmount: prior,
		},
	})
}

func TestNewMemberIsHeldThenTrusted(t *testing.T) {
	r := &Reviewer{cfg: defaultConfig()}
	first := review(r, 1, 0, "누수 견적 질문", "견적이 두 배 차이 나요", "ko_KR")
	if first.Approved || first.ReviewStatus != plugin.ReviewStatusNeedReview {
		t.Fatalf("first post should wait for review, got %+v", first)
	}
	if !strings.Contains(first.Reason, "새 회원") {
		t.Fatalf("reason should be in Korean on a Korean site, got %q", first.Reason)
	}
	second := review(r, 1, 1, "Second question", "Another plain question", "en_US")
	if !second.Approved {
		t.Fatalf("member with an approved post should be published, got %+v", second)
	}
}

func TestPersonalDetailsHeldEvenForTrustedMembers(t *testing.T) {
	r := &Reviewer{cfg: defaultConfig()}
	got := review(r, 1, 12, "Claim help", "My claim number is CLM-2026-014233, call 703-555-0142", "en_US")
	if got.Approved {
		t.Fatal("post with a claim number and phone should wait for review")
	}
	for _, want := range []string{"phone number", "claim or policy number"} {
		if !strings.Contains(got.Reason, want) {
			t.Fatalf("reason %q should mention %q", got.Reason, want)
		}
	}
}

func TestAdminsAndModeratorsAreNotHeld(t *testing.T) {
	r := &Reviewer{cfg: defaultConfig()}
	for _, role := range []int{roleAdmin, roleModerator} {
		if got := review(r, role, 0, "Office hours", "Call 703-555-0142", "en_US"); !got.Approved {
			t.Fatalf("role %d should not be held, got %+v", role, got)
		}
	}
}

func TestConfigReceiver(t *testing.T) {
	r := &Reviewer{cfg: defaultConfig()}
	raw := `{"hold_new_user_posts":false,"new_user_threshold":"3","check_personal_info":false,"check_off_site":true,"extra_phrases":"free inspection\n"}`
	if err := r.ConfigReceiver([]byte(raw)); err != nil {
		t.Fatal(err)
	}
	if r.cfg.HoldNewUserPosts || r.cfg.CheckPersonalInfo || !r.cfg.CheckOffSite || r.cfg.NewUserThreshold != 3 {
		t.Fatalf("config not applied: %+v", r.cfg)
	}
	if got := review(r, 1, 0, "Roof", "Call 703-555-0142", "en_US"); !got.Approved {
		t.Fatalf("with both checks off this should pass, got %+v", got)
	}
	if got := review(r, 1, 0, "Roof", "We do a FREE inspection", "en_US"); got.Approved {
		t.Fatal("extra phrase should hold the post")
	}
}
