package detect

import (
	"reflect"
	"testing"
)

var all = Options{PersonalInfo: true, OffSite: true}

func TestDetect(t *testing.T) {
	cases := []struct {
		name string
		text string
		want []Finding
	}{
		{"plain Korean question", "부엌 싱크대 밑 배관이 새서 바닥이 젖었습니다. 견적이 4천 달러, 6천 달러로 차이가 큽니다.", nil},
		{"amounts and years are fine", "The roofer quoted $14,000 and wants half. Our policy renews in 2026.", nil},
		{"claim mentioned without a number", "I filed a claim 2 weeks ago and the adjuster came on 11/3.", nil},
		{"long ids are not phones", "See question 10010000000000029 for details.", nil},

		{"US phone dashes", "Call the office at 703-555-0142 tomorrow", []Finding{FindingPhone}},
		{"US phone parens", "번호는 (571) 555 0199 입니다", []Finding{FindingPhone}},
		{"US phone +1", "+1 202.555.0175", []Finding{FindingPhone}},
		{"Korean mobile", "제 번호 010-1234-5678", []Finding{FindingPhone}},
		{"email", "write to minji.k@example.com please", []Finding{FindingEmail}},
		{"claim number English", "My claim number is CLM-2026-014233.", []Finding{FindingClaimOrPolicy}},
		{"policy number with hash", "Policy # HO3 88412907", []Finding{FindingClaimOrPolicy}},
		{"claim number Korean", "클레임 번호 0412337781 로 접수했어요", []Finding{FindingClaimOrPolicy}},
		{"policy number Chinese", "我的保单号是 PL20261108", []Finding{FindingClaimOrPolicy}},
		{"street address", "Our house at 4211 Oak Hill Dr flooded", []Finding{FindingStreetAddress}},
		{"street address abbreviation with dot", "1234 N. Glebe Rd. Arlington", []Finding{FindingStreetAddress}},
		{"ssn", "SSN 123-45-6789", []Finding{FindingSSN}},

		{"off-site English", "I'm a PA, DM me and I can help", []Finding{FindingOffSite}},
		{"off-site Korean", "자세한 건 카톡으로 연락주세요", []Finding{FindingOffSite}},
		{"off-site Chinese", "可以加我微信聊", []Finding{FindingOffSite}},

		{"several at once", "Text me at 703-555-0142, claim no. 77812345", []Finding{FindingPhone, FindingClaimOrPolicy, FindingOffSite}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Detect(c.text, all)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("Detect(%q) = %v, want %v", c.text, got, c.want)
			}
		})
	}
}

func TestDetectRespectsOptions(t *testing.T) {
	text := "DM me, my number is 703-555-0142"
	if got := Detect(text, Options{}); got != nil {
		t.Fatalf("all checks off: got %v", got)
	}
	if got := Detect(text, Options{PersonalInfo: true}); !reflect.DeepEqual(got, []Finding{FindingPhone}) {
		t.Fatalf("personal info only: got %v", got)
	}
	if got := Detect(text, Options{OffSite: true}); !reflect.DeepEqual(got, []Finding{FindingOffSite}) {
		t.Fatalf("off-site only: got %v", got)
	}
}

func TestExtraPhrases(t *testing.T) {
	opts := Options{OffSite: true, ExtraPhrases: []string{"free inspection"}}
	if got := Detect("We offer a FREE inspection this week", opts); !reflect.DeepEqual(got, []Finding{FindingOffSite}) {
		t.Fatalf("extra phrase: got %v", got)
	}
}

func TestSplitLines(t *testing.T) {
	got := SplitLines("  call me \n\n카톡\n  ")
	want := []string{"call me", "카톡"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SplitLines = %v, want %v", got, want)
	}
}
