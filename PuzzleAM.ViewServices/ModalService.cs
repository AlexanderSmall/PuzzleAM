using System.Collections.Generic;
using PuzzleAM.View;

namespace PuzzleAM.ViewServices;

/// <summary>
/// Service responsible for managing modal view models.
/// </summary>
public class ModalService
{
    private readonly List<ModalView> _modals = [];

    public IReadOnlyList<ModalView> Modals => _modals;

    public void Show(ModalView modal)
    {
        if (!_modals.Contains(modal))
        {
            modal.IsVisible = true;
            _modals.Add(modal);
        }
    }

    public void Hide(ModalView modal)
    {
        if (_modals.Remove(modal))
        {
            modal.IsVisible = false;
        }
    }
}
