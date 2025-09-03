using PuzzleAM.Model;

namespace PuzzleAM.View;

/// <summary>
/// View model for a modal component.
/// </summary>
public class ModalView
{
    public string Title { get; set; } = string.Empty;
    public ModalData? Data { get; set; }
    public bool IsVisible { get; set; }
}
