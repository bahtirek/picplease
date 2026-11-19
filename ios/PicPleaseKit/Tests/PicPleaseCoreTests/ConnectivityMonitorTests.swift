import Testing

@testable import PicPleaseCore

/// Not in docs/mobile/tests.md; covers the debounce behind `observe()`.
@Suite struct ConnectivityDebounceTests {
    @Test func firstValueAtOnceThenOnlySettledChanges() async {
        let (source, feed) = AsyncStream<Bool>.makeStream()
        var out = ConnectivityMonitor.debounced(source, by: .milliseconds(100)).makeAsyncIterator()

        feed.yield(true)
        #expect(await out.next() == true)

        // A short flap is swallowed: false then true again before the interval passes.
        feed.yield(false)
        feed.yield(true)
        // A real drop holds and comes through.
        try? await Task.sleep(for: .milliseconds(20))
        feed.yield(false)
        #expect(await out.next() == false)
    }
}
