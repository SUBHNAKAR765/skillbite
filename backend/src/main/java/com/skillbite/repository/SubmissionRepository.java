package com.skillbite.repository;

import com.skillbite.model.Problem;
import com.skillbite.model.Submission;
import com.skillbite.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface SubmissionRepository extends JpaRepository<Submission, Long> {
    List<Submission> findByUserOrderBySubmittedAtDesc(User user);
    List<Submission> findByUserAndProblemOrderBySubmittedAtDesc(User user, Problem problem);
}
