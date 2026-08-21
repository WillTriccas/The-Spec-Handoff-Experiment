namespace LegacyTradeReconciliation
{
    public static class Program
    {
        public static int Main(string[] args)
        {
            return new ReconciliationBatch().Run(args);
        }
    }
}
