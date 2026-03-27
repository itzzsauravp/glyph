export default abstract class BaseCommand {

    public readonly abstract id: string
    public abstract action: () => void

}