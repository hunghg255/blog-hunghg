---
title: 'Bếp Michelin, Không Phải Nhà Máy: Q&A Giữa Matt Pocock Và Poteto Về 2.500 PR/Tháng'
description: 'Ghi chép buổi trò chuyện giữa Matt Pocock và Poteto (Cursor): trust ladder, verification, inner loop/outer loop, chief-of-staff agent và cách để agent tự merge code'
date: '2026-10-04'
series: ai
seriesOrder: 2
author: hunghg255
image: https://blog.hunghg.me/blogs/michelin-kitchen.png
tags: ['ai', 'agents', 'cursor', 'skills', 'productivity', 'engineering', 'translation']
---

# Bếp Michelin, Không Phải Nhà Máy: Q&A Giữa Matt Pocock Và Poteto Về 2.500 PR/Tháng

## **Ghi chép buổi trò chuyện giữa Matt Pocock và Poteto — hai người đứng sau hai bộ skill nổi tiếng nhất cho AI agent hiện nay**

---

## Giới Thiệu

Ở [bài trước](/blogs/trust-your-ai-agents-verification-constraints), mình đã tổng hợp buổi talk của Poteto (Lauren Tan, engineer tại Cursor, trước đó làm ở team React của Meta) về cách xây dựng niềm tin với AI agent. Talk đó lan truyền rất mạnh trên X với tiêu đề kiểu *"Tôi đã ship 2.500 PR lên production tháng trước"*.

Lần này là một buổi **Q&A giữa Matt Pocock** (người làm Total TypeScript và một bộ skill rất phổ biến) **và Poteto** (tác giả plugin **Pstack**). Cộng đồng gọi đây là cuộc gặp gỡ trên "đỉnh Olympus của skill". Matt Pocock thừa nhận chưa dùng nhiều skill của Poteto và muốn "vắt hết nước trong não" của Poteto ra.

Buổi trò chuyện đi sâu hơn nhiều so với talk gốc, đặc biệt ở phần **cơ chế để scale lên hàng nghìn PR**: ai kích hoạt agent, agent lấy context từ đâu, ai review, và khi nào thì dám để agent tự merge.

> Một chi tiết vui: "Poteto" đọc là "potato". Đó là cách viết "kiểu Nhật" vì cái tên potato đúng chính tả đã có người dùng — từ hồi Poteto còn chơi game và muốn một nickname dễ thương liên quan đến đồ ăn.

---

## Phần 1: Hành Trình Leo "Trust Ladder"

Hành trình bắt đầu từ **trước khi** Poteto vào Cursor.

Sau khi rời Meta, Poteto nghỉ một tháng vì bị burnout. Và khi bị burnout thì người ta làm gì? **Mở một side project mới**, tất nhiên rồi.

Lúc đó (khoảng tháng 1–2), cộng đồng đang mê mẩn chuyện **orchestration**: ai cũng tự viết orchestrator riêng trong terminal. Poteto cũng bị cuốn vào, và nhận ra một điều:

> Mình đang dành **hàng giờ để micromanage đúng một agent**.

Poteto bắt đầu viết skill, nhưng gặp khó khăn trong việc **đo lường tác động** của skill — gần như là "bay mù", dù vẫn lặp lại rất nhanh. Side project đó (vẫn open source trên GitHub của Poteto) có một thư mục skill và một thư mục `brain`, và về sau trở thành nền móng của Pstack. Ý tưởng cốt lõi:

> Làm sao **rút được năng lực của chính mình** ra và trao nó cho agent? Mục tiêu của mình chỉ là dạy agent code giống mình hơn, làm workflow giống mình hơn.

Khi vào Cursor (tháng 3), Poteto được điều sang giúp **Agents Window** — ứng dụng đang rất lag. Giai đoạn đầu hoàn toàn thủ công: soi flame graph, heap snapshot. Và lại quay về đúng nhận thức cũ:

> Mình là **"meat proxy"** — cái proxy bằng xương bằng thịt đứng giữa agent và Chrome DevTools.

Lúc đó Poteto nhận ra những bài học từ bộ skill cũ — đặc biệt là **verification** và **sự nghiêm ngặt** — vẫn hoàn toàn đúng. Vì theo kinh nghiệm của Poteto, ngay cả model frontier cũng **có xu hướng đi đường tắt**. Nên phần lớn skill đều xoay quanh một câu hỏi:

> **Làm sao để cách dễ nhất cũng chính là cách đúng nhất?**

---

## Phần 2: Domain Expertise Quan Trọng Hơn Bao Giờ Hết

Nhiều người nghĩ chuyên môn sâu đang mất giá vì AI. Poteto nghĩ ngược lại.

Khi model ngày càng giỏi, **bottleneck không còn là agent**, mà là **khả năng của bạn trong việc diễn đạt ý định (intent) và mục tiêu** một cách rõ ràng để agent hiểu và thực hiện.

Đó là lý do người có chuyên môn sâu — bác sĩ, luật sư, hay bất kỳ ai giỏi một lĩnh vực ngoài kỹ thuật — chỉ cần **hơi tò mò về công nghệ** là đã có lợi thế rất lớn: nếu họ có tầm nhìn rõ ràng và diễn đạt được nó, họ có thể xây được sản phẩm tốt.

### Ngôn ngữ là đòn bẩy

Matt Pocock (người có bằng về kịch nghệ, nên đã nghĩ về ngôn ngữ và Shakespeare từ lâu) chia sẻ rằng từ khi có agent, mình bị ám ảnh bởi **cách chọn từ**. Điều thú vị nhất là khi tìm được **một từ mà agent "bám" vào**, rồi tái sử dụng trong thinking trace của nó.

- **TDD** là ví dụ điển hình. Tranh cãi "có nên dùng TDD với agent không" thực ra không quan trọng. Điều quan trọng là từ đó khiến agent **nghĩ về test**, viết test, và ưu tiên mọi thứ theo cách khác.
- **"Tautological tests"** (test lặp lại chính nó, test vô nghĩa) là một mẹo của Matt mà Poteto đã "copy" về. Một từ như *tautology* **nén rất nhiều ý nghĩa** vào một chữ — và agent hiểu ngay.
- Kỹ thuật **"grilling"** (để agent tra hỏi bạn) hiệu quả vì nó **kéo những từ đó ra khỏi đầu bạn**, hoặc giúp agent hiểu suy nghĩ của bạn để đề xuất đúng từ, và bạn chỉ cần gật đầu: "đúng rồi, chính nó".

> Với agent, ngôn ngữ tự nhiên và ngôn ngữ lập trình gặp nhau. Suy cho cùng, tất cả đều là **giao tiếp**.

---

## Phần 3: Bếp Michelin Thay Vì "Software Factory"

"Software factory" đang là buzzword. Poteto không thích từ này lắm — không phải vì nó sai, mà vì "nhà máy" thường **không gợi đến chất lượng và sự tỉ mỉ**, những thứ rất quan trọng với người làm sản phẩm.

Poteto chọn hình ảnh **bếp nhà hàng Michelin**: nấu ăn vừa mang tính thực dụng (để no bụng) vừa có thể trở thành **nghệ thuật**.

### Từ đầu bếp tại gia đến bếp trưởng

Hình ảnh này khớp hoàn toàn với trust ladder:

1. **Đầu bếp tại gia:** bạn tự làm tất cả — thái rau, sơ chế, nấu, dọn dẹp. Một người cân cả căn bếp.
2. **Thêm người vào bếp:** người yêu, anh chị em, rồi cả gia đình cùng vào. Hầu hết mọi người sẽ **rất căng thẳng** — ai cũng lóng ngóng, không biết dụng cụ để đâu. (Matt Pocock: *"Bếp nhà mình sức chứa tối đa là một người."*)
3. **Bếp trưởng:** bạn không tự nấu mọi món nữa. Bạn giống như **tech lead của căn bếp** — lo nhập nguyên liệu khi nào, bảo quản ra sao, sơ chế thế nào, món nào cần chuẩn bị lúc nào.

Engineer bây giờ cũng vậy: bạn không tự viết code nữa, nhưng **bạn vẫn chịu trách nhiệm cho kết quả cuối cùng** — tên tuổi và uy tín của bạn gắn liền với nó.

> Cách bạn bố trí căn bếp — **skill, môi trường, codebase** — chính là **nguyên liệu mới** để làm ra sản phẩm.

Matt Pocock bổ sung một ý rất đáng suy ngẫm: nhiều người nghĩ *"agent đã tốt rồi, mình chẳng làm nó tốt hơn được, cứ tin vào harness và model thôi"*. Nhưng bạn **hoàn toàn thay đổi được môi trường** agent làm việc: codebase, công cụ, và đặc biệt là khả năng tự kiểm chứng.

---

## Phần 4: Verification — Cho Agent "Tay Và Mắt"

Poteto nhắc lại: **dù không dùng Pstack hay bất kỳ bộ skill nào, skill quan trọng nhất cần có là verification.**

Verification là cho agent **"tay và mắt"**: nó có thể chạy code, tương tác như người dùng thật, debug, lấy trace và snapshot.

Đây là skill đầu tiên Poteto viết khi vào Cursor, và cũng là skill **thực sự giúp leo trust ladder** — điều mà các skill khác (như `how`, `why`, `unslop`) không làm được. Vì dù các skill khác tốt đến đâu, **Poteto vẫn là proxy** giữa agent và kết quả.

### "Loop" thực chất là gì?

Ai cũng nói về "agent loop", nghe khá trừu tượng. Theo Poteto:

> Phần quan trọng nhất khiến một loop **thực sự là loop** chính là **verification**. Agent tự kiểm chứng được công việc của mình, và bạn được rút ra khỏi phương trình.

Khi có loop, bạn có thể **hill climb** — thuật ngữ mà các AI lab hay dùng: có một rubric để chấm điểm, và agent liên tục cải thiện để tăng điểm. (Andrej Karpathy cũng từng release một dự án tên *autoresearch* với ý tưởng tương tự.)

Tại Cursor, giờ **mỗi app đều có verification skill riêng, tự động được bảo trì**, và nó đã trở thành **hạ tầng thiết yếu** mà cả team dùng.

---

## Phần 5: CLI Trong Skill — Tách Phần Tất Định Khỏi Phần Cần Phán Đoán

Trong talk, Poteto có nhắc đến một **CLI tự viết** đi kèm verification skill. Matt Pocock hỏi: tại sao lại đi xa đến vậy?

Lý do ban đầu là **context window**. Hồi cuối năm ngoái, compaction/summarization còn kém, đến mức có meme rằng agent "compact một lần là ngu luôn phần còn lại của session". Giờ harness đã tốt hơn nhiều, nhưng giữ context sạch vẫn có lợi.

Lý do quan trọng hơn là một nguyên tắc thiết kế:

> Công việc là một **dải liên tục** giữa phần cần **phán đoán** (judgment) và phần **tất định** (deterministic). Hãy rút phần tất định ra thành code, chỉ để lại phần cần phán đoán cho agent.

- Phần cần phán đoán: kết hợp nhiều nguồn context, suy luận, ra quyết định.
- Phần tất định: ví dụ refactor từ pattern này sang pattern khác — rất máy móc, không cần agent "sáng tạo lại" mỗi lần.

Vì vậy, skill giống như **một lớp vỏ mỏng**: vài hướng dẫn nhẹ về cách dùng các công cụ tùy biến nằm bên trong skill. Bản thân CLI chẳng có gì mới — chỉ là "keo dán" gọi Playwright, Chrome DevTools Protocol và vài API.

### Agent "xây lại thế giới" mỗi lần

Trước khi có CLI, Poteto để ý thấy: mỗi lần agent muốn verify, nó **tự viết script từ đầu** — và mỗi agent viết một kiểu. Agent trước viết được script chạy tốt nhưng rồi vứt đi; agent sau lại viết lại, chạy lỗi, sửa… Lãng phí cả context lẫn **thời gian**.

Giải pháp hiển nhiên: đóng gói thành CLI, đặt vào skill, để **mọi agent đều hưởng lợi**.

Matt Pocock tóm lại rất hay: đây là cách **giấu thông tin khỏi skill** — giữ skill nhỏ gọn, đẩy phần phức tạp mang tính tất định vào script, để agent làm những việc nhất quán **một cách nhất quán hơn**.

Nguyên tắc này áp dụng mạnh nhất cho **migration**: chuyển từ công nghệ này sang công nghệ khác (đặc biệt là công nghệ thân thiện với agent hơn) nên dựa vào **codemod** — duyệt AST và biến đổi code một cách cơ học bằng script, thay vì để agent tự sửa từng file.

> Câu hỏi đáng tự đặt ra: **bao nhiêu phần trong skill và rule của bạn thực ra có thể là code tất định?**

---

## Phần 6: Môi Trường Là Công Việc Mới Của Engineer

Matt Pocock đưa ra một định nghĩa về codebase tốt mà mình rất thích:

> **Codebase tốt là codebase dễ thay đổi** — thay đổi mà không làm hỏng thứ khác. Điều đó có nghĩa là có nhiều guardrail, và cả người lẫn agent bị giới hạn trong những con đường hẹp.

Vậy việc đầu tư vào môi trường quan trọng thế nào so với việc làm tính năng?

Theo Poteto: **công việc mới của engineer chính là đầu tư vào môi trường.**

### Cái bẫy của con dao cùn

Nếu chưa đầu tư xây niềm tin với agent, bạn sẽ mắc kẹt ở bậc thấp của trust ladder. Cách duy nhất để xoay xở là **ngồi micromanage agent** — rất tốn thời gian, và bạn chẳng còn thời gian nghĩ đến những thứ ở tầm cao hơn.

Giống như một developer chưa từng biết đến VS Code, Vim hay Git, chỉ dùng Notepad. Bạn **chưa từng mài dao**. Dao cùn thì làm gì cũng chậm. Rồi deadline dồn tới, bạn càng không có thời gian mài dao — một vòng luẩn quẩn.

> Nếu băm tỏi quá chậm, người ta đã phát minh ra dụng cụ ép tỏi. Một căn bếp Michelin mà đầu bếp không có dụng cụ thì mọi thứ sẽ kém hiệu quả, và **mỗi người sẽ tự chế ra cách riêng của mình**.

### Bài học từ TypeScript: thu hẹp không gian

Cả Matt Pocock và Poteto đều có xuất phát điểm từ TypeScript. Poteto từng nói ở TSConf về **type narrowing** — tính năng yêu thích nhất của Poteto trong TypeScript: đi từ một type rất rộng (có thể là bất cứ thứ gì), qua type guard và kiểm tra runtime, thu hẹp lại thành một type rất cụ thể.

Ràng buộc trong codebase cũng giống hệt vậy: bạn **thu hẹp không gian khả năng** đến mức chỉ còn đúng một cách làm.

Đó là tinh thần của **Dune** — framework nội bộ, kiểu "Next.js cho các ứng dụng Electron" của Cursor:

- Lint rule **cực kỳ chặt**
- Codebase được thiết kế để **chỉ có một cách làm** mỗi việc
- Mỗi feature có **thư mục riêng**, được phát hiện tự động qua registry
- Kết quả: **rất khó để viết code tệ**, và cả người lẫn agent không phải nghĩ về chuyện đó nữa

Ý tưởng thư mục feature đến từ một nỗi đau thật: **những phiên bản đầu tiên của sản phẩm chỉ gồm khoảng 8 "god file", mỗi file ít nhất 10.000 dòng.** Agent cứ thế append vào god file.

> Hãy quan sát agent như diều hâu. Mỗi lần thấy một lỗi, lùi lại và hỏi: **làm sao biến điều này thành lint rule? Làm sao để codebase khiến lỗi này trở nên bất khả thi?**

Matt Pocock tóm lại: lợi ích của việc đưa rule vào môi trường là **không làm quá tải agent** với những thứ phải nhớ. Agent sẽ tự "va" vào rule đúng lúc nó cần.

---

## Phần 7: 2.500 PR Đến Từ Đâu? Inner Loop Và Outer Loop

Đây là phần mình thấy giá trị nhất buổi trò chuyện.

Điều kiện tiên quyết vẫn là **môi trường**. Poteto ví von: đã dành thời gian xây xong **một căn bếp, một nhà hàng** hoàn chỉnh, giờ có thể **mở nhà hàng thứ hai, thứ ba** — giống Gordon Ramsay đã dạy executive chef mọi bí quyết. Mỗi project lớn là một nhà hàng, và Poteto "bay trực thăng" qua lại giữa chúng.

### Inner loop vs outer loop

- **Inner loop:** các agent engineer làm việc trên code, hướng đến một **"ảnh chụp" ý định** của bạn.
- **Outer loop:** thế giới bên ngoài — Slack, Linear, X, email… nơi bug report, feature request và context mới liên tục xuất hiện.

Vấn đề: ảnh chụp ý định **sẽ cũ đi**. Thông tin mới xuất hiện ở outer loop, và nếu không có gì kéo nó vào inner loop, **bạn phải tự làm proxy** — đi gom context từ Slack, X… rồi chuyển cho agent.

Giải pháp là **nối hai vòng lặp lại với nhau**:

- **Outer loop:** dùng các "personal agent" có connector tới Slack, email, lịch, Linear… (Poteto dùng sản phẩm mới của Cursor — trong transcript gọi là "Grockbot"). Các agent này có **routine** để liên tục theo dõi, ví dụ: *"Theo dõi bug của app desktop, thấy thì gửi sang Cursor project của tôi."*
- **Inner loop:** **Cursor Projects** — một **coordinator agent** chạy trên cloud, có máy riêng. Nó **không tự làm việc**, mà giống **executive chef / chief of staff**: quản lý danh sách task, spawn sub-agent, truyền context, và đẩy công việc tiến lên.

> Một chủ đề lặp đi lặp lại: luôn tự hỏi **"Mình đang là bottleneck ở đâu? Tại sao agent cần mình để trả lời câu hỏi này?"** — rồi dạy agent tự tìm câu trả lời. Không phải bằng cách đoán, mà bằng **dữ liệu thật**.

Poteto cho rằng những thuật ngữ như "company brain" hay "context graph" phức tạp không cần thiết. Thực chất chỉ là: **thông tin nào agent cần mà bạn đang phải tự chuyển cho nó? Hãy dạy nó tự lấy.**

### "Context, not control"

Hồi làm ở Netflix, Poteto được nghe các manager nói mãi về nguyên tắc **"context, not control"**. Nó chuyển sang thế giới agent một cách hoàn hảo: bạn có thể đạt kết quả bằng kiểm soát (micromanage), nhưng điều bạn thực sự muốn là **cung cấp context** để agent — cũng như engineer — tự chủ được.

### Tại sao cần coordinator thay vì một agent cho mỗi bug?

Giả sử có 30 bug report về performance đổ về cùng lúc. Bạn có thể spawn 30 agent, mỗi agent một bug. Nhưng:

- Bạn **mất sợi chỉ liên kết** giữa chúng
- Các agent có thể **làm trùng việc**
- Không ai nhìn thấy **vấn đề ở tầng cao hơn**

Khi sửa bug, có nhiều báo cáo hơi khác nhau giúp bạn **lùi lại để nhìn toàn cảnh**: nhìn một báo cáo thì tưởng lỗi ở đây, nhưng nhìn cả loạt thì thấy gốc rễ ở chỗ khác. Coordinator agent có thể tự chọn **topology** phù hợp để phân việc.

### Hàng đợi thay vì sửa ngay

Không phải PR nào cũng đến từ bug report. Rất nhiều là **"gardening"** — chăm sóc codebase. Một routine thú vị của Poteto: một agent liên tục đi tìm các **pattern bị cấm** (React thì nhiều "foot gun" lắm).

Điểm hay là Poteto **không bảo nó sửa ngay**, mà bảo nó **ghi vào một tài liệu**. Vài ngày một lần, Poteto đọc lại và nhận ra: *"À, những cái này thực ra là cùng một vấn đề."*

> Khi ở chế độ thực thi thuần túy, xử lý từng "order" thật nhanh, bạn dễ **bỏ lỡ bức tranh lớn**. Một **bộ đệm / hàng đợi** buộc bạn (hoặc agent) phải nhìn ra pattern. Đó cũng là lợi ích của chief-of-staff agent: nó **nhìn thấy cả khu rừng**, không chỉ từng cái cây.

Hiện tại Poteto có **hơn 10 "chief of staff"**, mỗi người phụ trách một mảng: một người lo performance app desktop, một người lo bug người dùng báo, một người… thử viết lại app bằng ngôn ngữ khác cho vui.

---

## Phần 8: Review 2.500 PR? Không — Hãy Lấy Mẫu

Câu hỏi ai cũng hỏi: *"Vậy ai review 2.500 PR đó? Team bạn chắc ghét bạn lắm."*

Matt Pocock hỏi theo kiểu ẩn dụ: *"Bạn có nếm hết 2.500 món đi qua trước mặt không?"*

Câu trả lời của Poteto: bạn **không bao giờ muốn ngừng nếm thử hoàn toàn**, nhưng ở quy mô này, không thể nếm từng món. Nên chuyển sang **lấy mẫu (sampling)** — giống người giám sát chất lượng trong nhà máy:

1. Mỗi ngày, đọc một số PR và **soi thật kỹ**
2. Tìm các pattern xấu, sự kém hiệu quả
3. **Sửa môi trường, không phải sửa từng agent**

Nếu chỉ là sự cố đơn lẻ thì có thể bỏ qua. Nhưng nếu **nhiều agent cùng mắc một lỗi** — cùng đi một đường tắt, cùng lan truyền một workaround — đó là tín hiệu cần điều chỉnh căn bếp: skill, ràng buộc, lint, type system.

> **Lấy mẫu thay vì chặn (sampling instead of blocking)** — Matt Pocock đánh giá đây là ý cực kỳ quan trọng.

### "Dark factory"?

Matt hỏi: vậy đây không phải "dark factory" (nhà máy tắt đèn, không cần người) đúng không? Poteto thừa nhận: **thực ra có đấy**. Poteto đi ngủ, agent làm việc 24/7, tự merge PR. Sáng dậy Poteto **review qua commit history**, thấy vấn đề thì revert, sửa, thêm lint rule.

Cơ chế đằng sau là chế độ **"full autopilot"** trong Pstack: với mỗi PR, nó spawn một loạt **verifier agent** để **fuzz** — chạy app thật, click lung tung như người dùng thật, tìm regression và bug, rồi tự sửa, lặp lại cho đến khi PR đủ điều kiện land. Chế độ này **tốn token**, nhưng có thể chỉnh: thay vì 10 verifier, dùng 1, hoặc chỉ bảo agent tự verify.

> Chính **verification + môi trường** là hai thứ cho phép bước ra khỏi bếp.

Poteto kể: ngày đầu tiên bật "dark factory" **rất đáng sợ** — *"Lỡ đêm nay mình làm sập cái gì thì sao?"*. Cần khá nhiều dũng khí. Nhưng giờ thì *"mình ngủ ngon hơn nhiều"*.

Matt Pocock chỉ ra một khác biệt quan trọng: định nghĩa "vibe coding" gốc của Karpathy là **quên luôn việc code tồn tại**. Cách của Poteto **ngược lại hoàn toàn**: code và môi trường là **cốt lõi** — garbage in, garbage out. Có lẽ nên gọi là **"công tắc dimmer"** — chỗ tối, chỗ sáng. Hoặc quay về hình ảnh nhà hàng: chủ chuỗi vẫn thỉnh thoảng ghé qua, nếm thử món ăn.

---

## Phần 9: Còn Những PR "Cửa Một Chiều" Thì Sao?

Matt Pocock đặt câu hỏi khó nhất: với các lĩnh vực như y tế, luật, tài chính, có những PR là **"cửa hai chiều"** (merge xong revert được) nhưng có những PR là **"cửa một chiều"** — gây mất dữ liệu, không thể quay lại. Nếu phần lớn PR là cửa một chiều thì sao?

Poteto trả lời thẳng thắn: **mình không có câu trả lời hoàn chỉnh.** Mọi thứ quay về **chất lượng verification**:

- Với lĩnh vực **verify được**, cửa một chiều phần nào trở thành cửa hai chiều.
- Với lĩnh vực **rất khó verify bằng chương trình**, đạt đến mức này là rất khó.

Kỹ thuật phần mềm may mắn là lĩnh vực **khá dễ verify**. Toán học cũng vậy ở một số khía cạnh (khi bạn viết chứng minh).

Dự đoán của Poteto: sẽ xuất hiện ngày càng nhiều **ngôn ngữ lập trình hướng agent**. Một ví dụ thú vị là **Bend** — ngôn ngữ kết hợp lập trình với **chứng minh hình thức**. Trước đây, bạn phải viết chứng minh ở một ngôn ngữ riêng như **Lean** hay **TLA+**, rồi dùng solver để đảm bảo đã bao phủ mọi trường hợp, không có race condition…

> Nếu code compile được, và chứng minh cho thấy nó đúng — **vậy tại sao lại không merge?**

---

## Phần 10: Skill Của Ai Thì Dùng? Hãy Có Bộ Dao Của Riêng Mình

Câu hỏi cuối: Pstack và bộ skill của Matt Pocock — nên dùng cái nào, kết hợp thế nào?

Cả hai đồng ý: **skill chỉ là quy trình được viết thành chữ.** Chỉ là markdown, chỉ là ngôn ngữ. Hai bộ skill **bổ trợ cho nhau** — ví dụ kết hợp skill *grill-me* hay *wayfinder* của Matt với các skill thực thi trong Pstack, hoặc trộn wayfinder với "potato mode" thành một mode riêng.

Nhưng Poteto nhấn mạnh:

> **Mỗi người nên có bộ dao của riêng mình.** Đầu bếp chuyển nhà hàng thì mang dao theo. **Niềm tin, suy cho cùng, là niềm tin vào chính công cụ của bạn.**

### Đào vàng từ transcript cũ

Mẹo thực tế nhất của buổi trò chuyện (Matt Pocock cũng vừa chia sẻ một mẹo tương tự):

> **Đọc lại transcript các phiên chat cũ.** Tìm những lần bạn phải sửa agent, phải can thiệp liên tục — rồi biến bài học ở tầng cao hơn thành skill hoặc lint rule.

Theo Poteto, lịch sử chat là **"kho báu context"**, vì đó là **quy trình đã được hiện thực hóa** — không phải ý tưởng trừu tượng trong đầu bạn, mà là những gì **thực sự diễn ra**.

Pstack có hẳn một skill tên **`recall`** từ chính pattern này: khi làm virtualization cho Cursor, có rất nhiều bug, và mỗi lần mở chat mới Poteto lại tiếc context của chat cũ. Thay vì mỗi lần viết một bài luận *"hãy đi đọc mấy chat này…"*, Poteto nén workflow đó thành một skill.

### Skill sẽ ngày càng nhỏ đi

Một nhận định thú vị về tương lai:

- **Skill năm ngoái** chứa nhiều **chi tiết triển khai**: chạy đúng lệnh này, script kia.
- **Với model mới nhất**, bạn có thể xóa hết những phần đó, chỉ tập trung vào **workflow** — một chuỗi các bước, một quy trình thật.

> Skill sẽ ngày càng **nhỏ và gọn** hơn. Và điều tuyệt vời nhất ở skill là nó **cực kỳ dễ uốn nắn** — chỉ là ngôn ngữ thôi.

Matt Pocock khép lại: *"Chẳng có gì ma thuật trong skill cả. Nếu có, thì đó là những từ được chọn, những cụm từ được dùng, và **sự suy nghĩ đã được bỏ ra** để biến một quy trình trừu tượng thành ngôn ngữ. Một khi suy nghĩ đó đã được làm xong, nó nằm ngay đó — bạn chỉ việc lấy dùng."*

---

## Góc Nhìn Của Mình

So với talk gốc, buổi Q&A này trả lời được câu hỏi mình thắc mắc nhất: **"2.500 PR thì ai giao việc, ai review?"**. Một vài điều mình rút ra:

**1. Scale không đến từ việc mở nhiều tab chat hơn.** Nó đến từ việc **tự động hóa đầu vào** (outer loop → inner loop) và **tự động hóa kiểm chứng** (verifier agent). Nếu bạn vẫn là người copy bug từ Slack dán vào agent, bạn vẫn là bottleneck — dù chạy bao nhiêu agent đi nữa.

**2. Tách tất định khỏi phán đoán là nguyên tắc dùng được ngay hôm nay.** Hãy xem lại các skill/rule của bạn: phần nào là "chạy lệnh này, rồi lệnh kia"? Biến nó thành script. Agent sẽ nhanh hơn, nhất quán hơn, và skill gọn hơn.

**3. Hàng đợi thay vì sửa ngay** là một ý rất tinh tế. Tự động hóa không có nghĩa là phản ứng tức thì với mọi tín hiệu. Đôi khi để dữ liệu tích lũy giúp nhìn ra vấn đề gốc.

**4. "Sampling instead of blocking" chỉ an toàn khi đã có môi trường đủ chặt.** Đừng bỏ qua bước này mà nhảy thẳng đến chuyện cho agent tự merge. Chính Poteto cũng nói rõ: *"Mình không muốn bán điều này như thứ ai cũng làm dễ dàng chỉ bằng cách cài Pstack."*

**5. Câu hỏi "cửa một chiều" vẫn bỏ ngỏ.** Mình đánh giá cao việc Poteto thừa nhận không có câu trả lời. Với hệ thống liên quan đến tiền, dữ liệu người dùng, migration database… mình vẫn sẽ giữ con người ở vòng review trước khi merge, ít nhất là cho đến khi có công cụ verify đủ mạnh.

**6. Việc nên làm ngay tuần này:** đọc lại 10–20 transcript chat gần nhất với agent, liệt kê những lần bạn phải sửa nó cùng một kiểu. Mỗi mục trong danh sách đó là một ứng viên cho lint rule, CI check, hoặc skill.

Nếu bài trước là **"tại sao"** phải xây niềm tin với agent, thì buổi Q&A này là **"cơ chế vận hành"** của căn bếp khi niềm tin đã đủ lớn. Và thông điệp chung vẫn không đổi: **hãy mài dao của chính mình.**

---

*Bài viết được tổng hợp và biên dịch từ transcript buổi livestream Q&A giữa Matt Pocock và Poteto. Một số tên riêng trong transcript gốc có thể bị nhận dạng giọng nói sai chính tả.*
