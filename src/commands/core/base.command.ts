export default abstract class BaseCommand {
    public abstract readonly id: string;
    public abstract action: () => void;
}
