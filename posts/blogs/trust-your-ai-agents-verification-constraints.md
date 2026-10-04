---
title: 'Từ Micromanage Đến Auto-merge: Làm Sao Để Thực Sự Tin Tưởng AI Agent Khi Viết Code'
description: 'Ghi chép từ buổi chia sẻ của một engineer tại Cursor — người merge ~1000 PR/tháng nhờ verification skill, eval và một codebase đầy ràng buộc'
date: '2026-10-04'
author: hunghg255
image: https://blog.hunghg.me/blogs/trust-ai-agents.png
tags: ['ai', 'agents', 'cursor', 'productivity', 'engineering', 'translation']
---

# Từ Micromanage Đến Auto-merge: Làm Sao Để Thực Sự Tin Tưởng AI Agent Khi Viết Code

## **Ghi chép từ buổi chia sẻ của Lauren — engineer tại Cursor, người đang để agent tự merge PR mỗi đêm**

---

## Giới Thiệu

Nếu bạn đã dùng AI agent để viết code một thời gian, chắc hẳn bạn đã gặp cảnh này: agent **tự tin tuyên bố** rằng nó đã tìm ra "smoking gun" — lần thứ một trăm — nhưng hóa ra đó không phải nguyên nhân thật. Nó đoán mò, nó hallucinate, và mỗi lần như vậy, lòng tin của bạn lại giảm đi một chút.

Đây chính là chủ đề trung tâm trong buổi chia sẻ của Lauren, một engineer tại Cursor (trước đó từng làm ở Meta và có nhiều kinh nghiệm với React). Câu hỏi họ đặt ra rất đơn giản:

> **Làm sao để tin tưởng agent của mình?**

Và câu trả lời của họ không phải là "dùng model mạnh hơn", mà là **xây dựng môi trường** để agent không thể làm sai — hoặc nếu làm sai thì bị phát hiện ngay.

Kết quả? Tháng trước Lauren ship khoảng **1000 PR**. Tháng này, mới đến ngày 12 đã gần **800 PR**. Và sáng nay khi thức dậy, có khoảng **20 PR đã được agent tự merge** vào main — họ chỉ review lại sau khi chúng đã landed.

Nghe có vẻ như một "slop artist", nhưng như Lauren nói: *"Tôi hứa là không phải vậy."* Bài viết này tóm tắt lại hành trình để đạt đến điểm đó.

---

## Phần 0: Trước Khi Nói Về Tốc Độ — AI Là Bạn Pair, Không Phải Người Nghĩ Thay

Buổi chia sẻ mở đầu bằng một góc nhìn khá tỉnh táo, đáng để đặt lên trước mọi con số "1000 PR/tháng":

> Cách dùng AI tốt nhất là coi nó như **một người bạn pair programming** — chứ không phải công cụ để thay thế hoàn toàn việc viết code, hay tệ hơn, để **outsource luôn cả việc suy nghĩ**.

Vì AI quá hấp dẫn, rất nhiều người cảm thấy **áp lực** phải nhét AI vào mọi thứ để tỏ ra "bắt kịp thời đại": phải tăng năng suất, phải ship 100 PR mỗi tuần dù chẳng hiểu mình đang làm gì, phải vibe-code đến triệu đô ARR…

Nhưng thực tế thường là: dùng AI giúp **tiết kiệm thời gian viết code**, nhưng lại **tốn thêm thời gian review và sửa lại** những gì AI làm. Ngay cả quy trình được nhiều người khuyên — để AI viết spec trước, review spec, rồi mới để nó code — cũng không tự động giải quyết được vấn đề này.

Đây chính là lý do toàn bộ phần còn lại của bài xoay quanh một chữ: **niềm tin**. Tốc độ chỉ có ý nghĩa khi bạn tin được output — và niềm tin đó phải được **xây dựng có hệ thống**, chứ không phải bằng cách nhắm mắt merge.

---

## Phần 1: Đường Cong Niềm Tin (The Trust Curve)

Lauren so sánh việc làm việc với agent giống như **làm quản lý**.

Hãy tưởng tượng bạn là engineering manager của một team, nhưng bạn **không tin** các thành viên trong team. Bạn sẽ làm gì? Bạn sẽ **micromanage** — đứng sau lưng từng người, kiểm tra từng dòng code, sợ họ ship bug lên production.

Làm việc với agent cũng y hệt:

- **Giai đoạn đầu (thiếu niềm tin):** Bạn làm việc với một vài agent, theo dõi **từng output**, ngồi prompt liên tục. Bạn **không thể song song hóa** — vì làm sao bạn spawn 100 agent khi bạn còn không tin nổi output của 1 agent?
- **Giai đoạn sau (có niềm tin):** Agent làm việc trên cloud, tự nhận việc từ bug report, tự mở PR, và thậm chí tự merge.

Biểu đồ đóng góp của Lauren tại Cursor phản ánh đúng đường cong này: tháng đầu tiên gần như không productive (đang học codebase), sau đó tăng vọt khi niềm tin vào agent tăng lên.

> **Bài học quan trọng:** Không có đường tắt để nhảy từ "ngồi canh 2–3 agent local" lên "chạy hàng trăm cloud agent". Nếu bạn cố nhảy cóc, bạn chỉ **đốt token** một cách vô ích.

---

## Phần 2: Verification — Kỹ Năng Quan Trọng Nhất

Theo Lauren, kỹ năng quan trọng nhất cần có khi làm việc với agent là **verification** (kiểm chứng).

Verification ở đây nghĩa là: **agent có khả năng tự chạy code thật** — tự mở app, tự lấy CPU trace, heap snapshot, mở iOS simulator… nói chung là tương tác với ứng dụng **giống như cách người dùng tương tác**, rồi tự kiểm tra xem nó có hoạt động không.

Verification **không đảm bảo** agent viết code *tốt*, nhưng nó đảm bảo agent viết code *đúng*. Và đó là một bước tiến cực lớn trong việc xây dựng niềm tin.

### Khi bạn là "verifier", bạn là bottleneck

Lauren kể lại câu chuyện tuần đầu tiên ở Cursor: họ được điều sang giúp team Agents Window (một ứng dụng React/Electron) ngay trước deadline launch một tuần. Vấn đề là performance.

Quy trình lúc đó:

1. Tự mở Chrome DevTools, lấy trace, nhìn flame graph (mà chưa hiểu gì về codebase)
2. Chụp màn hình, tải trace, gửi cho agent
3. Agent trả lời đại loại "hình như là chỗ này" — rất tự tin
4. Sửa thử → không phải nguyên nhân thật
5. Lặp lại…

Nếu bạn từng làm performance hay debug với agent mà **không có verification skill**, bạn sẽ hiểu cảm giác này: **bạn chính là người kiểm chứng**. Agent viết code → bạn mở dev build → bạn thấy không chạy → bạn copy screenshot, console error → agent sửa tiếp. Bạn luôn ở trong vòng lặp, và không có cách nào song song hóa.

### Control skill: cho agent "đôi tay"

Một trong những skill đầu tiên Lauren xây dựng là **control skill** cho Agents Window (codename nội bộ là "Glass"). Phần code thì không có gì đặc biệt — agent của bạn hoàn toàn có thể tự viết. Ý tưởng là:

- Với **Electron app / web app**: dạy agent dùng **Chrome DevTools Protocol (CDP)** để điều khiển app, click, lấy trace…
- Với **iOS**: dùng các tiện ích của Apple để chạy simulator, lấy trace, điều khiển bằng code

### Feature Map: cho agent "tấm bản đồ"

Nhưng có đôi tay thôi chưa đủ. Sau khi có control skill, agent đã có thể chạy app và lấy trace — nhưng nó **không biết app có những gì**. Ai đó báo "sidebar bên trái bị lag" hay "tab PR không hoạt động", và agent cứ loay hoay: tính năng này nằm ở đâu trong code? Làm sao đi đến nó trên UI?

Giải pháp là một file đặc biệt gọi là **Feature Map**. File này mô tả, cho từng tính năng:

- Tính năng đó là gì, có những sub-feature nào
- **Từ góc nhìn người dùng**, làm sao để đi đến nó
- Các **phím tắt** liên quan
- Các **DOM element / attribute** dùng để select qua CDP

Nhờ vậy, ngay cả những bug report **cực kỳ mơ hồ** — như một screenshot kèm dòng chữ "???" trong kênh Slack feedback — agent vẫn có đủ context để biết phải navigate đến đâu và tái hiện lỗi thế nào.

> 💡 Lauren có một plugin tên **Pstack** (chữ "P" là "potato" — một cách đùa vui với **gstack** của Garry Tan, CEO Y Combinator, người tình cờ cùng họ). Trong đó có skill **create verification** giúp agent tự khám phá codebase và tạo Feature Map ban đầu, cùng skill **maintain verification** để giữ nó luôn cập nhật.

---

## Phần 3: Skill — Cách "Onboard" Một Engineer Giỏi Nhưng Không Có Context

Lauren không hề lên kế hoạch xây dựng Pstack. Nó bắt đầu từ việc **quan sát agent thất bại**.

Ví dụ: họ đưa cho agent một bug report, agent tự tin kết luận "chắc chắn là do chỗ này". Nhưng khi mở các tool call ra xem, họ phát hiện agent **thậm chí còn chưa đọc** đoạn code mà lẽ ra phải bị ảnh hưởng. Lúc đó, niềm tin gần như bằng không.

Thay vì cảm thấy bất lực, hãy quay lại phép so sánh với quản lý:

> Bạn vừa tuyển một engineer **code rất giỏi** nhưng **không có chút business context nào** — họ mới onboard được 5 giây. Bạn sẽ dạy họ làm việc hiệu quả như thế nào?

Câu trả lời là **skill**. Skill chỉ là markdown thôi, nhưng nó mã hóa rất nhiều thông tin và hướng dẫn. Một số người gọi đó là "kéo agent vào một latent space khác" — nói đơn giản: LLM dự đoán token tiếp theo, nên khi bạn cho nó những token chất lượng cao ngay từ đầu, nó sẽ "pattern match" ở một mức thông minh hơn.

Cách Lauren xây Pstack rất **tăng dần (incremental)**: mỗi lần thấy một failure mode của agent, biến nó thành một skill:

- Đừng hallucinate — hãy **thực sự tìm và đọc code**
- Dùng **nhiều sub-agent**
- **Đừng đoán**

---

## Phần 4: Eval — Unit Test Cho Skill

Câu hỏi tiếp theo: làm sao **bảo trì** skill khi sản phẩm thay đổi liên tục? Và làm sao biết verification **đủ tốt** để tin?

Câu trả lời là **eval**. Mental model của Lauren: **eval giống như unit test cho agent**. Bạn không cần framework đặc biệt nào — bạn có thể tự xây, tùy mức độ nghiêm ngặt bạn muốn.

Trong Pstack có một "Eval playbook" khá chặt chẽ. Quy trình đại khái:

1. Một **coordinator agent** chính đặt ra **rubric** — skill này cần làm được gì
2. Coordinator spawn nhiều **sub-agent**, mỗi agent chạy trong một thư mục riêng
3. Tên thư mục được đặt **khéo léo để sub-agent không biết mình đang bị đánh giá** — vì agent *có thể nhận ra* điều đó, và khi nhận ra, chúng thay đổi hành vi
4. Chạy eval trên **nhiều model khác nhau** để xem skill hoạt động ra sao trên cả ma trận model
5. Dùng một **judge agent thuộc model khác** để cross-check, tránh việc model chấm điểm bị bias

### Hill climbing

Vì eval cho ra điểm số, bạn có thể **hill climb**: dùng kiểu `/loop` và bảo agent "cứ lặp lại eval này cho đến khi mọi thứ đạt 10/10". Lauren đã xây control skill (và CLI đi kèm) theo cách này — khá "hands-off".

Tuy vậy, Lauren nhấn mạnh: **bảo trì skill thực sự khó**, đòi hỏi nhiều **taste và quan sát**. Bạn cần trở thành một **"backseat driver"** giỏi — giống như khi pair programming, bạn nhìn đồng nghiệp code và liên tục hỏi "sao không làm thế này?". Ở giai đoạn đầu, đừng là người quan sát thụ động: hãy mở các tool call, đọc thinking block, xem agent sai ở đâu — rồi biến điều đó thành skill.

### Bắt đầu từ đâu?

**Bắt đầu ở local.** Ở local bạn có thể quan sát trực tiếp: agent bật app lên như thế nào, gọi API gì để tương tác với nó. Khi đã tin tưởng, mới chuyển lên cloud.

---

## Phần 5: Từ Local Lên Cloud — Khi Verification Nâng Tầm Cả Team

Hiện tại Lauren gần như **all-in vào cloud agent**. Điểm mạnh là: một khi bạn đã đầu tư setup môi trường và verification skill, chúng **không chỉ giúp bạn** mà còn **nâng tầm cả team, cả công ty**.

Ví dụ: Cursor có một agent tên **Benny**. Mỗi khi có bug report:

1. Benny tự khởi động một máy trên cloud, chạy Cursor trên desktop của nó
2. Dùng **cùng các control skill** để tương tác với app và **tái hiện bug**
3. Báo cáo kết quả

Trong một ví dụ, Benny đã tái hiện được bug **và xác nhận nó đã được fix trên main** — tất cả những gì cần làm là release bản build mới. Đó là thông tin mà trước đây phải ngồi cả tiếng với agent để tìm ra.

Tóm lại hành trình:

```
Verification local  →  Tin tưởng output  →  Cloud agent nhận signal (bug report…)
                                         →  Agent tự mở PR  →  Auto-merge
```

---

## Phần 6: Nên Rewrite Hay Không? Câu Chuyện Về "Organic Architecture"

Phần thú vị và gây tranh cãi nhất: **refactor và rewrite**.

Xưa nay, lời khuyên phổ biến là **đừng rewrite**. Nhưng Lauren đưa ra một góc nhìn khác.

### "Trước AI slop, chúng ta đã có human slop"

Lauren nhận thấy: **các vấn đề của big tech giờ là vấn đề của tất cả mọi người.** Ở Meta, với monorepo khổng lồ và hàng chục nghìn engineer, chất lượng code… thực ra không tốt như bạn nghĩ.

Vì vậy, hạ tầng của big tech được thiết kế cho "**engineer kém nhất trong team**": framework, convention, guardrail, giới hạn credential để intern không xóa nhầm production database.

Hệ quả:

- **Brownfield app** (đã có hạ tầng và guardrail tốt): agent đã có thể làm việc khá ổn, vì guardrail ngăn chúng phá hoại.
- **Greenfield app** (đặc biệt là prototype vibe-code): đây là **rủi ro lớn nhất** — nhưng cũng là **cơ hội lớn nhất**.

### Organic architecture

Khi app được vibe-code hoàn toàn, **không có guardrail nào**. Agent sẽ giải quyết mỗi task theo cách **tiện nhất**. Lâu dần, codebase phát triển một cách "hữu cơ" và **mất kiểm soát** — bạn không hiểu nó, còn agent thì xây nó theo kiểu tối ưu cho đường tắt.

Lauren đã trải qua đúng điều này với một sản phẩm mới của Cursor (được prototype rất nhanh, không ai đọc code). Họ đã bỏ ra **hơn 600 PR** để refactor toàn bộ sang một kiến trúc mới, codename **Dune**.

Kết quả: giờ đây Lauren **gần như không cần nhìn code nữa**. Không phải để "bán token", mà vì đã đầu tư rất nhiều công sức để codebase đạt đến trạng thái **có thể tin tưởng**. Và không chỉ Lauren hưởng lợi — **designer, PM, thậm chí người làm GTM** cũng có thể thêm tính năng mà không ai phải lo nửa đêm có người vừa merge một performance regression.

> *"Viết code trong codebase này thực ra rất khó chịu vì có quá nhiều ràng buộc — nhưng agent hấp thụ hết sự khó chịu đó."*

---

## Phần 7: Kiến Trúc Dune — "Đường Ngắn Nhất Là Đường Tốt Nhất"

Dune có thể hiểu như **"Next.js cho Electron app"**, nhưng được thiết kế **để agent viết**. Nó là tập hợp ý tưởng và nguyên tắc hơn là một thư viện sẽ open source.

### Những thứ bị CI cấm hẳn

- **`useEffect` bị cấm.** Đây là một trong những "foot gun" lớn nhất của React. Dùng là CI đỏ.
- **Code comment bị cấm.** Nghe lạ, nhưng 99% thời gian agent viết comment mô tả **bối cảnh lịch sử không liên quan**. Ví dụ: *"Lauren nói không bao giờ được làm thế này"* — trong khi đó chỉ là feedback cho một PR cụ thể, không phải quy tắc toàn cục. Agent hiểu chúng ta không giỏi như ta tưởng.
- **Import sai process bị chặn.** Trong Electron, renderer thread phải vẽ mỗi frame trong ~**16ms** để đạt 60fps. Nếu code nặng (tính toán, IO) vô tình bị kéo vào renderer, app sẽ giật lag. Dune có thư mục `electron-main` và `electron-renderer` riêng, và **CI kiểm tra dependency graph** để đảm bảo không import chéo.

Nguyên tắc chung: **agent hay làm sai cái gì, cấm cái đó.**

### Convention mạnh mẽ

Dune có các "danh từ" rõ ràng: **feature**, **entry point**, **transcript card**… Mỗi feature nằm gọn trong **một thư mục duy nhất**. Agent làm việc với feature onboarding? Chỉ cần làm trong thư mục đó — 80% công việc được đóng gói ở đây.

Nguyên tắc cốt lõi:

> **Đường ngắn nhất phải là đường tốt nhất.**

Agent luôn thích đi đường tắt, tìm cách nhanh nhất để giải quyết vấn đề. Vậy thì hãy thiết kế để **cách nhanh nhất cũng chính là cách đúng nhất**. Thêm nữa, agent rất thích **copy pattern có sẵn** — nên convention nhất quán là lực ép mạnh nhất.

### Các tầng enforcement

Lauren chia ra nhiều tầng, từ cứng đến mềm:

| Tầng | Ví dụ | Mức độ |
| --- | --- | --- |
| 1. Codebase / Kiến trúc | Feature trong 1 thư mục, chặn import sai | **Cứng** |
| 2. Static analysis | CI check, lint rule, compiler diagnostics | **Cứng** (CI đỏ) |
| 3. Rules (`AGENTS.md`) | Hướng dẫn cho agent | Mềm |
| 4. Bugbot | Code review tự động trên CI | Mềm |
| 5. Skills / Style guide | Markdown hướng dẫn | Mềm |

Các tầng mềm vẫn hữu ích, nhưng **agent có thể quên** hoặc áp dụng không nhất quán. Nếu bạn chỉ dựa vào rules, skill và style guide:

> *"Chỉ là vấn đề thời gian trước khi codebase của bạn trông như rác."*

Đây cũng là lý do **lựa chọn tech stack** quan trọng. **Rust** đang hot trở lại một phần vì compiler cực kỳ chặt: có borrow checker, và nếu agent không viết `unsafe`, bạn có thể khá tự tin rằng **code compile được thì nhiều khả năng là chạy đúng**.

### Code review thủ công là một code smell

Nơi tệ nhất để mắc kẹt là **"code review land"** — nơi mọi invariant của codebase được đảm bảo bởi con người đọc code và comment "đừng làm thế này".

> Mỗi lần bạn phải comment như vậy, hãy coi đó là một **anti-pattern**. Hãy tự hỏi: *Làm sao biến điều này thành lint rule? Thành CI failure? Hay loại bỏ hoàn toàn loại vấn đề này?*

### Về kích thước PR

Không có giới hạn cứng — PR có thể từ 50 dòng đến cả nghìn dòng tùy việc. Nhưng Lauren **khuyến khích agent chia nhỏ** công việc thành nhiều PR, vì:

- **Git history là nguồn context rất giàu** — mỗi PR nên mô tả một thay đổi nhỏ, nguyên tử
- Dễ **revert** và dễ tìm ra bug nằm ở đâu, thay vì chìm trong một PR 40.000 dòng

> 💡 Fun fact: phần virtualization (render danh sách lớn) trong sản phẩm này và trong Cursor được xây dựng trên **Pretext** — một thư viện khá mới, đáng để tìm hiểu.

---

## Phần 8: Còn Chi Phí Token Thì Sao?

Câu hỏi được hỏi nhiều nhất: điều này có thực tế với người **không có token vô hạn** không?

Lauren thừa nhận thẳng thắn: làm ở một AI lab thì token gần như không giới hạn, nên không thể bảo mọi người làm y hệt. Nhưng với engineering leader hay founder, đây là **bài toán ROI**:

- Đúng, giai đoạn đầu (refactor, thêm ràng buộc) **tốn rất nhiều token**
- Nhưng nếu tương lai là agent viết phần lớn code, bạn muốn **giữ team tinh gọn**, không muốn trở thành một tổ chức 10.000 engineer với đủ thứ overhead
- Một mình Lauren, ở thời tiền-agent, sẽ mất **nhiều năm** để xây framework, refactor và test hết mọi thứ — và lương của họ không hề rẻ
- Khi codebase đã đủ ràng buộc, **ngay cả những model nhỏ hơn, rẻ hơn** cũng viết code rất tốt

Câu hỏi thực sự là: thuê thêm người, hay chi token để dựng một codebase mà **ngay cả agent "ngốc" nhất** cũng làm tốt? Theo Lauren, nếu tự phân tích, ROI thường **khá tích cực**.

---

## Phần 9: Còn PM, Designer Thì Theo Kịp Thế Nào?

Khi engineer ship nhanh như vậy, các bộ phận khác làm sao theo kịp?

Theo Lauren, nhờ kiến trúc chặt chẽ của Dune, **PM và designer giờ cũng ship code**. Thường xuyên có PM nhắn: *"Có bug này, mình fix rồi, xem giúp nhé"* — Lauren review và thấy… hoàn hảo, approve luôn.

Đây là bằng chứng rằng **ràng buộc chặt chẽ cho phép người không chuyên engineering đóng góp ở chất lượng cao**. PM cũng dùng agent để tóm tắt những gì Lauren làm đêm qua, để luôn nắm được tiến độ.

---

## Phép So Sánh: Engineer Như Một Bếp Trưởng

Lauren có một hình ảnh rất hay:

> Bạn giờ giống như **bếp trưởng** trong một nhà hàng. Bạn không tự nấu mọi món nữa. Bạn có line cook, có sous chef, có nhiều trạm khác nhau. Việc của bạn là **thiết kế căn bếp** — bố trí môi trường, phân công công việc.

---

## Tổng Kết: Những Điều Bạn Có Thể Làm Ngay

1. **Xây verification skill trước tiên.** Cho agent khả năng tự chạy app, lấy trace, tự kiểm chứng — để bạn không còn là bottleneck.
2. **Tạo Feature Map.** Cho agent biết app có gì và đi đến từng tính năng ra sao.
3. **Quan sát failure mode và biến chúng thành skill.** Đọc tool call, thinking block. Hãy là một backseat driver khó tính.
4. **Viết eval cho skill.** Coi chúng như unit test, chạy trên nhiều model, dùng judge agent khác model, hill climb.
5. **Bắt đầu ở local, rồi mới lên cloud.** Đừng nhảy cóc lên hàng trăm agent khi chưa tin nổi một agent.
6. **Ưu tiên ràng buộc cứng hơn ràng buộc mềm.** Lint, CI, compiler, kiến trúc > rules, skills, style guide.
7. **Mỗi comment review lặp lại là một cơ hội tự động hóa.** Biến nó thành lint rule hoặc CI check.
8. **Thiết kế để đường ngắn nhất cũng là đường đúng nhất.**
9. **Chia PR nhỏ, nguyên tử.** Git history là context quý giá.
10. **Với greenfield app, đặt ràng buộc ngay từ đầu** — trước khi "organic architecture" nuốt chửng codebase.

Cuối cùng, mọi thứ quay về một từ: **niềm tin**. Mỗi người có một tiêu chuẩn engineering khác nhau. Khi bạn **mã hóa được tiêu chuẩn đó** thành skill, eval, lint và CI — và **kiểm chứng được** rằng agent thực sự tuân theo — bạn mới có thể leo lên đường cong niềm tin và bắt đầu tự động hóa thật sự.

---

## Góc Nhìn Của Mình: Nên Học Gì, Nên Dè Chừng Gì

Sau khi nghe hết buổi chia sẻ, mình có vài nhận xét riêng.

### Những điểm mình thấy rất đáng giá

**1. Chuyển trọng tâm từ "prompt giỏi" sang "môi trường tốt".** Đây là ý quan trọng nhất của buổi talk. Phần lớn nội dung về AI coding hiện nay xoay quanh việc viết prompt sao cho hay hay chọn model nào. Lauren thì gần như không nhắc đến prompt. Mọi thứ đều xoay quanh **môi trường**: verification, feature map, eval, lint, CI, kiến trúc. Prompt hay chỉ giúp được một lần, còn môi trường tốt thì giúp được mọi lần chạy, cho mọi agent và mọi người trong team.

**2. Câu "comment review lặp lại là code smell" áp dụng được ngay, kể cả khi không dùng AI.** Từ trước khi có agent, đây đã là một nguyên tắc tốt. Có agent rồi thì nó còn đáng làm hơn, vì agent sẽ lặp lại đúng lỗi đó hàng trăm lần nếu không có gì chặn lại.

**3. "Đường ngắn nhất là đường tốt nhất" là một nguyên tắc thiết kế API và kiến trúc rất hay.** Thay vì cố bắt agent (hay con người) phải kỷ luật, hãy để cách làm đúng cũng là cách làm dễ nhất. Ý này gần với triết lý "pit of success" mà nhiều framework tốt theo đuổi.

**4. Feature Map là một ý tưởng nhỏ nhưng hiệu quả lớn.** Nó gần như là tài liệu onboarding cho agent. Viết xong thì engineer mới vào team cũng đọc được.

### Những điểm nên dè chừng

**1. Bối cảnh rất đặc biệt.** Lauren làm ở một AI lab, có token gần như vô hạn và được làm việc trên chính sản phẩm của công ty mình. Con số 1000 PR/tháng rất ấn tượng, nhưng đừng lấy nó làm mục tiêu. **Số PR không phải là thước đo chất lượng.** Chính Lauren cũng thừa nhận người khác hoàn toàn có lý khi hỏi "bao nhiêu phần trong đó là code tốt?".

**2. Auto-merge vẫn là một canh bạc với đa số team.** Nó chỉ an toàn khi đã có đủ các lớp ràng buộc cứng. Buổi talk cũng chưa nói nhiều về những chỗ CI khó bắt lỗi: logic nghiệp vụ sai nhưng vẫn pass test, lỗ hổng bảo mật, hay những thay đổi UX nhỏ mà không ai nhờ.

**3. Cấm comment là một lựa chọn gây tranh cãi.** Lý do thì hợp lý: agent hay viết comment mang tính lịch sử, vô nghĩa. Nhưng comment giải thích **"tại sao"** (một quyết định không hiển nhiên, workaround cho bug của thư viện…) vẫn rất có giá trị. Với đa số team, mình nghĩ nên **lint để chặn comment kiểu lịch sử** hoặc yêu cầu comment phải giải thích lý do, thay vì cấm hoàn toàn.

**4. Refactor 600+ PR không phải ai cũng làm được.** Lời khuyên "đặt ràng buộc từ đầu cho greenfield app" thì ai cũng nên làm. Còn "rewrite cả codebase" cần được cân nhắc kỹ với ngân sách token và độ ổn định sản phẩm của team bạn.

**5. Eval tốn kém và khó làm đúng.** Chạy hàng loạt sub-agent trên nhiều model, kèm judge agent, là cách làm nghiêm túc nhưng tốn chi phí. Với team nhỏ, chỉ cần vài kịch bản test cố định cho mỗi skill và chạy lại khi sửa skill là đã hơn hẳn việc không có gì.

### Nếu là một team nhỏ, mình sẽ bắt đầu thế nào?

Không cần làm hết, chỉ cần đi theo thứ tự:

1. **Tuần 1:** Cho agent khả năng **tự chạy app và tự kiểm tra**: script khởi động dev server, Playwright/CDP để mở trang và chụp màn hình, đọc được log. Chỉ riêng bước này đã giúp bạn bớt làm bottleneck.
2. **Tuần 2:** Viết một **Feature Map** đơn giản, có thể nhờ chính agent khám phá code để viết bản nháp. Viết thêm `AGENTS.md` ngắn gọn với những quy ước quan trọng nhất.
3. **Liên tục:** Mỗi lần phải sửa agent cùng một lỗi lần thứ hai, hãy biến nó thành **lint rule hoặc CI check**. Nếu không làm được thì mới viết thành rule/skill.
4. **Khi đã tin:** Mới thử cho agent chạy song song nhiều task hơn, rồi chuyển lên cloud. Auto-merge thì cứ để sau cùng, hoặc chỉ áp dụng cho những loại thay đổi rủi ro thấp (docs, dependency bump, fix lint…).

### Kết

Buổi chia sẻ này thay đổi câu hỏi mình hay tự đặt ra. Câu hỏi không còn là *"AI có viết code tốt không?"* mà là *"Môi trường của mình đã đủ tốt để AI không thể viết code tệ chưa?"*.

Agent rồi sẽ ngày càng thông minh hơn. Nhưng những gì bạn đầu tư vào **verification, ràng buộc và kiến trúc rõ ràng** thì vẫn sẽ có giá trị, dù model thay đổi thế nào và dù người viết code là agent hay con người. Vai trò của engineer đang dịch dần từ người tự nấu từng món sang **người thiết kế căn bếp**. Theo mình, đó là kỹ năng đáng đầu tư nhất lúc này.

---

*Bài viết được tổng hợp và biên dịch từ transcript buổi chia sẻ của Lauren (Cursor). Một số tên riêng trong transcript gốc có thể bị nhận dạng giọng nói sai chính tả.*
